// Stroke graphics (frame, corners, underline) → filters. Reached only from the compile path
// (compositing.ts → SugarContext.masks.strokes), never eagerly. This module resolves what frame and
// corners share (the box they run along, even-pixel thickness and radius, contrast-aware ink, the entrance
// and exit windows) and hands the per-type plan (stroke-outline.ts) to the drawing (stroke-lower.ts).
// The underline has its own, simpler lowering (stroke-underline.ts).

import type { Filter } from '@/core/types';
import { parseEasing } from '@/core/motion/easing';
import { resolveFxTarget } from './fx-target';
import { STROKE_DEFAULTS } from './graphics-lines';
import { INK, type Rect } from './graphics-spec';
import { backgroundAt, luminance, parseHex, pickInk } from './stroke-contrast';
import { strokeFilters, type StrokeShadow } from './stroke-lower';
import { cornersPlan, framePlan } from './stroke-outline';
import { inflate } from './stroke-shapes';
import { entrancePhase, exitPhase, strokeSamples } from './stroke-timeline';
import { lowerUnderline } from './stroke-underline';
import type { StrokeRequest } from './sugar-context';
import {
  DEFAULT_CLEARANCE,
  SMOOTH,
  even,
  splitColor,
  spriteInput,
  warn,
  type Outline,
  type OutlineRequest,
} from './stroke-kit';

const SHADOW_ALPHA = 0.4;

function frameSize(request: StrokeRequest): { width: number; height: number } {
  const [width, height] = request.ctx.scale.split(':').map(Number);

  return { width, height };
}

// The rectangle the strokes run along: the target pushed out by `clearance`, or the frame minus `inset`.
function boxOf(request: OutlineRequest): Rect | null {
  const g = request.graphic;
  const { width, height } = frameSize(request);

  if (g.target === undefined) {
    const inset = even(g.inset ?? (g.type === 'frame' ? 48 : 56));

    return { x: inset, y: inset, w: width - 2 * inset, h: height - 2 * inset };
  }

  const target = resolveFxTarget(g.target, { section: request.section, ctx: request.ctx });

  if (!target) return null;

  const grown = inflate(target, even(g.clearance ?? DEFAULT_CLEARANCE));
  const [x, y] = [Math.max(0, grown.x), Math.max(0, grown.y)];
  const [right, bottom] = [Math.min(width, grown.x + grown.w), Math.min(height, grown.y + grown.h)];

  return right - x >= 8 && bottom - y >= 8 ? { x, y, w: right - x, h: bottom - y } : null;
}

export function outline(request: OutlineRequest, box: Rect): Outline {
  const g = request.graphic;
  const defaults = STROKE_DEFAULTS[g.type];
  const fps = request.ctx.fps;
  const thickness = Math.max(2, even(g.thickness ?? 4));
  const radius = g.radius
    ? Math.min(Math.max(Math.round(g.radius), thickness), Math.floor(Math.min(box.w, box.h) / 2))
    : 0;
  const duration = g.duration ?? defaults.duration;
  const entrance = entrancePhase(request.at, duration, fps);
  const exitKind = g.exit ?? defaults.exit;
  const end = request.until ?? (exitKind === 'none' ? undefined : request.ctx.duration);
  const exitDuration = g.exitDuration ?? Math.min(0.35, Math.max(0.15, 0.6 * duration));
  const settled = entrance.start + entrance.frames / fps;
  const exit = exitKind === 'none' ? null : exitPhase(end, exitDuration, settled, fps);
  const curve = parseEasing(g.ease ?? defaults.ease).fn;

  return { request, box, thickness, radius, fps, curve, smooth: parseEasing(SMOOTH).fn, entrance, exit, exitKind, end };
}

// Points the strokes pass over, for the background probe: the box corners and edge midpoints.
function probePoints(o: Outline): Array<{ x: number; y: number }> {
  const { x, y, w, h } = o.box;
  const half = o.thickness / 2;
  const xs = [x + half, x + w / 2, x + w - half];
  const ys = [y + half, y + h / 2, y + h - half];

  return xs.flatMap((px, i) => ys.flatMap((py, j) => (i === 1 && j === 1 ? [] : [{ x: px, y: py }])));
}

export interface Ink {
  color: string;
  alpha: number;
  shadow: StrokeShadow | null;
}

function backgroundLumas(o: Outline): (number | null)[] {
  return probePoints(o).map((point) => {
    const rgb = backgroundAt(o.request.section, o.request.ctx, point);

    return rgb ? luminance(rgb) : null;
  });
}

export function inkOf(o: Outline): Ink {
  const g = o.request.graphic;
  const authored = g.color ? (o.request.ctx.masks?.color(g.color) ?? g.color) : null;
  const { hex, alpha } = splitColor(authored ?? `${INK}@${g.type === 'frame' ? 0.9 : 1}`);
  const contrast = g.contrast ?? 'auto';
  const shadow = { offset: Math.max(2, even(o.thickness / 2)), alpha: SHADOW_ALPHA };

  if (contrast !== 'auto') return { color: hex, alpha, shadow: contrast === 'shadow' ? shadow : null };

  const ink = pickInk(authored && parseHex(hex) ? hex : null, INK, backgroundLumas(o));

  return { color: ink.color, alpha, shadow: ink.shadow ? shadow : null };
}

function drawOutline(o: Outline, ink: Ink, radius: number): Filter[] | null {
  const shaped = { ...o, radius };
  const plan = o.request.graphic.type === 'frame' ? framePlan(shaped) : cornersPlan(shaped);
  const fades = o.exitKind === 'fade' || o.exitKind === 'expand';

  return strokeFilters({
    paths: plan.paths,
    thickness: o.thickness,
    ...ink,
    samples: strokeSamples(plan),
    fadeIn: plan.fadesIn ? o.entrance : null,
    fadeOut: fades ? o.exit : null,
    fps: o.fps,
    prefix: `gs${o.request.index}_`,
    sprite: spriteInput(o.request),
  });
}

function lowerOutline(request: OutlineRequest): Filter[] {
  const box = boxOf(request);

  if (!box) {
    warn(request, 'stroke_target', 'the target names nothing in this section (or leaves no room); skipped');

    return [];
  }

  const o = outline(request, box);
  const ink = inkOf(o);
  const filters = drawOutline(o, ink, o.radius);

  if (filters) return filters;

  warn(request, 'stroke_square', 'rounded corners need an extra input this segment cannot take; drawn square');

  return drawOutline(o, ink, 0) ?? [];
}

/** One stroke graphic as filters (the masks.strokes entry). */
export function lowerStroke(request: StrokeRequest): Filter[] | null {
  if (request.graphic.type === 'underline') {
    return lowerUnderline(request as StrokeRequest & { graphic: { type: 'underline' } });
  }

  return lowerOutline(request as OutlineRequest);
}
