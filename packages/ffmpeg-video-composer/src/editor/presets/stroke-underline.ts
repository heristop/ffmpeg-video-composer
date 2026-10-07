// The underline: a rule that draws on along an expo curve, runs `settle` × its width past
// its end and settles back, with round caps (the two halves of one anti-aliased disc sprite riding the
// ends) and a visible exit before `until` or the end of the section (fade, or retract: it undraws from
// the side it grew from). Straight body: drawbox per frame, like every graphic. Square caps need no
// sprite. See stroke-lower.ts for how the caps follow the body to the pixel.

import type { Filter } from '@/core/types';
import { parseEasing } from '@/core/motion/easing';
import type { CurveFn } from '@/core/motion/curves';
import { boxes, BRAND, windowExpr, withAlpha, type Rect } from './graphics-spec';
import { STROKE_DEFAULTS } from './graphics-lines';
import { addStep, closeGraph, spriteOverlays, stageChain, type SpriteTrack } from './stroke-lower';
import { entrancePhase, exitPhase, type StrokePhase } from './stroke-timeline';
import { SMOOTH, even, splitColor, spriteInput, warn } from './stroke-kit';
import type { StrokeRequest } from './sugar-context';

export type UnderlineRequest = StrokeRequest & { graphic: { type: 'underline' } };

export interface Extent {
  from: number;
  to: number | undefined;
  /** Left and right ends of the whole line, caps included. */
  left: number;
  right: number;
  alpha: number;
}

/** Share of the entrance spent reaching the overshoot; the rest settles back. */
const REACH = 0.72;

/** The draw-on: the ease up to 1 + settle over the first REACH of the time, then a smooth return to 1. */
export function settleCurve(base: CurveFn, settle: number): CurveFn {
  if (settle <= 0) return base;

  const smooth = parseEasing(SMOOTH).fn;

  return (u) => (u < REACH ? (1 + settle) * base(u / REACH) : 1 + settle * (1 - smooth((u - REACH) / (1 - REACH))));
}

function span(origin: string, x: number, width: number, p: number): { left: number; right: number } {
  const w = width * p;

  if (origin === 'center') return { left: x + (width - w) / 2, right: x + (width + w) / 2 };

  return origin === 'right' ? { left: x + width - w, right: x + width } : { left: x, right: x + w };
}

export interface Line {
  x: number;
  y: number;
  width: number;
  thickness: number;
  origin: string;
}

function lineOf(request: UnderlineRequest): Line {
  const g = request.graphic;
  const [width, height] = request.ctx.scale.split(':').map(Number);

  return {
    x: Math.round(g.x ?? width * 0.08),
    y: even(g.y ?? height * 0.62),
    width: Math.round(g.width ?? width * 0.3),
    thickness: Math.max(2, even(g.thickness ?? 6)),
    origin: g.origin ?? 'left',
  };
}

export interface Setup {
  line: Line;
  fps: number;
  entrance: StrokePhase;
  exit: StrokePhase | null;
  retract: boolean;
  color: string;
  alpha: number;
  /** Half the thickness when the caps are round sprites, else 0. */
  cap: number;
}

const RETRACT_TOWARD: Record<string, string> = { left: 'right', right: 'left', center: 'center' };

// The exit window: before `until`, or the end of the section when it holds; none when exit is "none".
function exitOf(request: UnderlineRequest, kind: string, duration: number, entrance: StrokePhase): StrokePhase | null {
  const fps = request.ctx.fps;

  if (kind === 'none') return null;

  return exitPhase(request.until ?? request.ctx.duration, duration, entrance.start + entrance.frames / fps, fps);
}

export function setup(request: UnderlineRequest): Setup {
  const g = request.graphic;
  const fps = request.ctx.fps;
  const line = lineOf(request);
  const defaults = STROKE_DEFAULTS.underline;
  const entrance = entrancePhase(request.at, g.duration ?? defaults.duration, fps);
  const exitKind = g.exit ?? defaults.exit;
  const exit = exitOf(request, exitKind, g.exitDuration ?? 0.3, entrance);
  const { hex, alpha } = splitColor(g.color ? (request.ctx.masks?.color(g.color) ?? g.color) : BRAND);
  const round = (g.caps ?? 'round') === 'round' && /^#[0-9a-f]{6}$/i.test(hex);

  return {
    line,
    fps,
    entrance,
    exit,
    retract: exitKind === 'retract',
    color: hex,
    alpha,
    cap: round ? line.thickness / 2 : 0,
  };
}

function entranceExtents(s: Setup, curve: CurveFn): Extent[] {
  const { start, frames } = s.entrance;

  return Array.from({ length: frames }, (_, f) => ({
    from: start + f / s.fps,
    to: start + (f + 1) / s.fps,
    ...span(s.line.origin, s.line.x, s.line.width, curve((f + 1) / frames)),
    alpha: 1,
  }));
}

function exitExtents(s: Setup): Extent[] {
  const exit = s.exit;

  if (!exit) return [];

  const smooth = parseEasing(SMOOTH).fn;
  const toward = RETRACT_TOWARD[s.line.origin] ?? 'right';

  return Array.from({ length: exit.frames }, (_, m) => ({
    from: exit.start + m / s.fps,
    to: exit.start + (m + 1) / s.fps,
    ...span(
      s.retract ? toward : s.line.origin,
      s.line.x,
      s.line.width,
      s.retract ? 1 - smooth((m + 1) / exit.frames) : 1
    ),
    alpha: s.retract ? 1 : 1 - m / exit.frames,
  }));
}

export function extents(request: UnderlineRequest, s: Setup): Extent[] {
  const g = request.graphic;
  const curve = settleCurve(parseEasing(g.ease ?? STROKE_DEFAULTS.underline.ease).fn, g.settle ?? 0.03);
  const settled = s.entrance.start + s.entrance.frames / s.fps;
  const hold = {
    from: settled,
    to: s.exit?.start ?? request.until,
    ...span(s.line.origin, s.line.x, s.line.width, 1),
    alpha: 1,
  };
  const holds = hold.to === undefined || hold.to > hold.from;

  return [...entranceExtents(s, curve), ...(holds ? [hold] : []), ...exitExtents(s)];
}

// The body as drawbox windows, and where each cap rides (left half and right half of the disc sprite).
function draw(s: Setup, all: Extent[]): { body: Filter[]; caps: SpriteTrack[] } {
  const { cap, line } = s;
  const t = line.thickness;
  const body: Filter[] = [];
  const caps: SpriteTrack[] = [
    { crop: { x: 0, y: 0, w: cap, h: t }, steps: [] },
    { crop: { x: cap, y: 0, w: cap, h: t }, steps: [] },
  ];

  for (const e of all) {
    const [left, right] = [Math.round(e.left), Math.round(e.right)];

    if (right - left < 2 * cap + 1) continue;

    const rect: Rect = { x: left + cap, y: line.y, w: right - left - 2 * cap, h: t };

    body.push(...boxes([rect], withAlpha(s.color, s.alpha * e.alpha), windowExpr(e.from, e.to)));
    addStep(caps[0].steps, { from: e.from, to: e.to, x: left, y: line.y });
    addStep(caps[1].steps, { from: e.from, to: e.to, x: right - cap, y: line.y });
  }

  return { body, caps };
}

/** One underline as filters. */
export function lowerUnderline(request: UnderlineRequest): Filter[] | null {
  const s = setup(request);
  const { body, caps } = draw(s, extents(request, s));

  if (s.cap === 0 || body.length === 0) return body;

  const stage = {
    fadeIn: null,
    fadeOut: s.retract ? null : s.exit,
    fps: s.fps,
    prefix: `gs${request.index}_`,
    sprite: spriteInput(request),
  };
  const t = s.line.thickness;
  const spec = { kind: 'piece' as const, shape: 'disc' as const, w: t, h: t, color: s.color.slice(1).toLowerCase() };
  const over = spriteOverlays(stage, { key: 'cap', spec, alpha: s.alpha, offset: 0 }, caps, `${stage.prefix}m0`);

  if (over) return closeGraph([stageChain(undefined, body, `${stage.prefix}m0`), ...over.chains]);

  warn(request, 'stroke_square', 'round caps need an extra input this segment cannot take; drawn square');

  return lowerUnderline({ ...request, graphic: { ...request.graphic, caps: 'square' } });
}
