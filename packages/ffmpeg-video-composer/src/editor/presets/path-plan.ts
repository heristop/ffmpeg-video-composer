// What the path graphic's lowering (path-draw.ts, path-riders.ts) resolves before it builds filters: the
// geometry in frame px with its arc length and box, the paint, and the timeline on the output frame grid
// (the drawing end's position per entrance frame, the exit, the end of its life).

import type { Filter } from '@/core/types';
import { parseColor, rgbToHex } from '@/core/color-contrast';
import { parseEasing } from '@/core/motion/easing';
import { fmt } from '@/core/motion/hermite';
import { BRAND, type Rect } from './graphics-spec';
import { PATH_DEFAULTS, pathCommandsOf, type PathGraphic } from './graphics-path';
import { flatten, traceOf, type PathCommand, type Traced } from './path-geometry';
import { splitColor } from './stroke-kit';
import { entrancePhase, exitPhase, type StrokePhase } from './stroke-timeline';
import { resolveFxTarget } from './fx-target';
import type { StrokeRequest } from './sugar-context';

export type PathRequest = StrokeRequest & { graphic: PathGraphic };

export interface Paint {
  /** "#rrggbb". */
  hex: string;
  alpha: number;
}

export interface Plan {
  traced: Traced;
  box: Rect;
  thickness: number;
  fps: number;
  entrance: StrokePhase;
  exit: StrokePhase | null;
  retract: boolean;
  /** When nothing is drawn any more; undefined holds to the cut. */
  end: number | undefined;
  /** Drawing-end fraction per entrance frame. */
  heads: number[];
}

export interface Geometry {
  commands: PathCommand[];
  traced: Traced;
  box: Rect;
}

export function warn(request: PathRequest, code: string, message: string): void {
  request.ctx.masks?.warn(`[${code}] graphics[${request.index}] path: ${message}`);
}

export function hexOf(color: string | undefined): string | null {
  const paint = color ? parseColor(color) : null;

  return paint ? rgbToHex(paint.rgb).toLowerCase() : null;
}

/** A colour as the filter paint: resolved token, "#rrggbb" and its @alpha. */
export function paintOf(request: PathRequest, color: string | undefined, fallback: string): Paint {
  const authored = color ? (request.ctx.masks?.color(color) ?? color) : fallback;
  const { hex, alpha } = splitColor(authored);

  return { hex: hexOf(hex) ?? fallback.toLowerCase(), alpha };
}

function evenDown(value: number): number {
  return 2 * Math.floor(value / 2);
}

function evenUp(value: number): number {
  return 2 * Math.ceil(value / 2);
}

// The stroke's box on even pixels (4:2:0 chroma), 2 px of anti-aliasing margin, clamped to the frame.
function boxOf(traced: Traced, thickness: number, scale: string): Rect | null {
  const [width, height] = scale.split(':').map(Number);
  const points = traced.subpaths.flat();
  const reach = thickness / 2 + 2;
  const x = Math.max(0, evenDown(Math.min(...points.map((p) => p.x)) - reach));
  const y = Math.max(0, evenDown(Math.min(...points.map((p) => p.y)) - reach));
  const right = Math.min(evenDown(width), evenUp(Math.max(...points.map((p) => p.x)) + reach));
  const bottom = Math.min(evenDown(height), evenUp(Math.max(...points.map((p) => p.y)) + reach));

  return right - x >= 2 && bottom - y >= 2 ? { x, y, w: right - x, h: bottom - y } : null;
}

/** The path in frame px, measured and boxed; null (after a warning) when there is nothing to draw. */
export function geometryOf(request: PathRequest): Geometry | null {
  return geometryParts(request);
}

function geometryParts(request: PathRequest): Geometry | null {
  const g = request.graphic;
  const target = g.target === undefined ? null : resolveFxTarget(g.target, request);

  if (g.target !== undefined && !target) {
    warn(request, 'path_target', 'the target names nothing in this section; skipped');

    return null;
  }

  const commands = pathCommandsOf(g, target);
  const traced = commands && traceOf(flatten(commands));
  const box = pathBox(traced, g.thickness ?? PATH_DEFAULTS.thickness, request.ctx.scale);

  if (!commands || !traced || !box) {
    warn(request, 'path_empty', 'the path is empty or entirely outside the frame; skipped');

    return null;
  }

  return { commands, traced, box };
}

function pathBox(traced: Traced | null, thickness: number, scale: string): Rect | null {
  if (!traced || traced.total <= 0) return null;

  return boxOf(traced, thickness, scale);
}

// The exit window and the end of the graphic's life.
function exitOf(request: PathRequest, settled: number): Pick<Plan, 'exit' | 'retract' | 'end'> {
  const g = request.graphic;
  const kind = g.exit ?? PATH_DEFAULTS.exit;
  const end = request.until ?? (kind === 'none' ? undefined : request.ctx.duration);
  const fallback = kind === 'retract' ? PATH_DEFAULTS.retractDuration : PATH_DEFAULTS.exitDuration;
  const exit = kind === 'none' ? null : exitPhase(end, g.exitDuration ?? fallback, settled, request.ctx.fps);

  return { exit, retract: kind === 'retract' && exit !== null, end };
}

export function plan(request: PathRequest, geometry: Geometry): Plan {
  const g = request.graphic;
  const fps = request.ctx.fps;
  const entrance = entrancePhase(request.at, g.duration ?? PATH_DEFAULTS.duration, fps);
  const curve = parseEasing(g.ease ?? PATH_DEFAULTS.ease).fn;
  const [from, to] = [g.from ?? 0, g.to ?? 1];
  // The last frame lands exactly on `to` (an ease may stop a hair short of 1).
  const heads = Array.from({ length: entrance.frames }, (_, f) =>
    f === entrance.frames - 1 ? to : from + (to - from) * curve((f + 1) / entrance.frames)
  );

  return {
    traced: geometry.traced,
    box: geometry.box,
    thickness: g.thickness ?? PATH_DEFAULTS.thickness,
    fps,
    entrance,
    ...exitOf(request, entrance.start + entrance.frames / fps),
    heads,
  };
}

export function strokePaint(request: PathRequest): Paint {
  return paintOf(request, request.graphic.color, BRAND);
}

export function settledAt(p: Plan): number {
  return p.entrance.start + p.entrance.frames / p.fps;
}

export function exitEnd(exit: StrokePhase, fps: number): number {
  return exit.start + exit.frames / fps;
}

/** An enable window [from, to), open-ended when `to` is undefined. */
export function window(from: number, to: number | undefined): string {
  return to === undefined ? `gte(t,${fmt(from)})` : `gte(t,${fmt(from)})*lt(t,${fmt(to)})`;
}

export function fadeOut(phase: StrokePhase, fps: number): Filter {
  return { type: 'fade', value: `t=out:st=${fmt(phase.start)}:d=${fmt(phase.frames / fps)}:alpha=1` };
}

export function alphaFilters(paint: Paint): Filter[] {
  return paint.alpha < 1 ? [{ type: 'colorchannelmixer', value: `aa=${fmt(paint.alpha)}` }] : [];
}
