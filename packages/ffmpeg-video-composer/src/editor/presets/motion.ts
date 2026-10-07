import type { Filter } from '@/core/types';
import type { MotionEffect } from '../../schemas/template.schemas';
import { fmt } from '@/core/motion/hermite';
import { exactZoomFilterObjects, ZOOM_TIME, type ZoomMove } from '@/core/motion/zoom-exact';

// motionToFilters — split out of looks.ts to keep that file under the max-lines budget; re-exported
// from looks.ts so importers (registry.ts, tests) keep a single `@/editor/presets/looks` entry point.

// ---------------------------------------------------------------------------
// motionToFilters
// ---------------------------------------------------------------------------

export type MotionContext = {
  duration: number;
  /** Scale as 'W:H', e.g. '1280:720' (from default.config.ts / videoConfig.scale). */
  scale: string;
  fps: number;
  /**
   * True for real footage (project_video/video): the zoom is then preceded by an fps conform so it
   * runs one output frame per input frame without retiming the clip. Every section stream (looped
   * still, colour source, footage) carries one frame per output frame, so the zoom always maps frames
   * 1:1. `duration` should be the clip's real (probed) length for video so the zoom/pan curve
   * completes across the footage.
   */
  isVideo?: boolean;
};

/**
 * Parses a 'W:H' scale string into numeric width and height.
 * Falls back to 1280x720 if the string is malformed.
 */
export function parseScale(scale: string): { w: number; h: number } {
  const parts = scale.split(':');
  const w = parseInt(parts[0] ?? '1280', 10);
  const h = parseInt(parts[1] ?? '720', 10);

  return { w: isNaN(w) ? 1280 : w, h: isNaN(h) ? 720 : h };
}

type KenBurnsEffect = Extract<MotionEffect, { type: 'kenburns' }>;
type RotateEffect = Extract<MotionEffect, { type: 'rotate' }>;
type CropEffect = Extract<MotionEffect, { type: 'crop' }>;
type FlipEffect = Extract<MotionEffect, { type: 'flip' }>;
type ShakeEffect = Extract<MotionEffect, { type: 'shake' }>;
type PulseEffect = Extract<MotionEffect, { type: 'pulse' }>;

/** The exact zoom filters, after an fps conform for real footage (one frame per frame). */
function exactZoom(move: ZoomMove, ctx: MotionContext): Filter[] {
  const { w, h } = parseScale(ctx.scale);
  const filters = exactZoomFilterObjects(move, { width: w, height: h, fps: ctx.fps });

  // Conform real footage to the target fps first, so the zoom runs on the output frame clock without
  // retiming the clip (a 25 fps source would otherwise play its frames 1:1 at 30 fps, ~20% fast).
  return ctx.isVideo ? [{ type: 'fps', value: `${ctx.fps}` }, ...filters] : filters;
}

/**
 * Ken Burns: a linear zoom or pan over the clip (`duration`, the real probed length for footage), lowered
 * to the exact sub-pixel zoom (core/motion/zoom-exact.ts) so slow moves never step by whole pixels.
 * Convention: "left" means the camera pans left-to-right across the image (the view moves right), so the
 * viewer sees the image drift left; "right" is the reverse; "up" moves the view down (the image drifts
 * up); "down" is the reverse. Pans hold the zoom at `intensity` and travel the whole overscan.
 */
function kenburnsToFilters(effect: KenBurnsEffect, ctx: MotionContext): Filter[] {
  const { w, h } = parseScale(ctx.scale);
  const intensity = effect.intensity ?? 1.15;
  const span = Math.max(1, Math.round(ctx.duration * ctx.fps)) / ctx.fps;
  const p = `min(${ZOOM_TIME}/${fmt(span)},1)`;
  const reachX = fmt((w * (intensity - 1)) / 2);
  const reachY = fmt((h * (intensity - 1)) / 2);
  const grow = fmt(intensity - 1);
  const moves: Record<string, ZoomMove> = {
    in: { zoom: `1+${grow}*${p}` },
    out: { zoom: `${fmt(intensity)}-${grow}*${p}` },
    left: { zoom: fmt(intensity), panX: `${reachX}*(2*${p}-1)` },
    right: { zoom: fmt(intensity), panX: `${reachX}*(1-2*${p})` },
    up: { zoom: fmt(intensity), panY: `${reachY}*(2*${p}-1)` },
    down: { zoom: fmt(intensity), panY: `${reachY}*(1-2*${p})` },
  };

  return exactZoom(moves[effect.direction ?? 'in'] ?? moves.in, ctx);
}

function rotateToFilters(effect: RotateEffect): Filter[] {
  return [{ type: 'rotate', value: `${effect.angle}*PI/180:c=black` }];
}

function cropToFilters(effect: CropEffect): Filter[] {
  const x = effect.x ?? '(iw-ow)/2';
  const y = effect.y ?? '(ih-oh)/2';

  return [{ type: 'crop', value: `${effect.w}:${effect.h}:${x}:${y}` }];
}

function flipToFilters(effect: FlipEffect): Filter[] {
  if (effect.axis === 'horizontal') {
    return [{ type: 'hflip' }];
  }

  return [{ type: 'vflip' }];
}

/**
 * Handheld camera shake: crops a window that wanders sinusoidally (x on sin, y on cos so the two axes
 * don't move in lockstep), then scales back to `ctx.scale`. The trailing scale is load-bearing: crop
 * alone shrinks the frame by `2*amplitude` px on each axis, and every downstream section must land on
 * the same output geometry for concat/xfade to line up — this is the invariant covered by the
 * "geometry-uniformity" test in looks.test.ts.
 */
function shakeToFilters(effect: ShakeEffect, ctx: MotionContext): Filter[] {
  const amplitude = effect.intensity ?? 6;
  const frequency = effect.frequency ?? 2;
  const cropWindow = `iw-${2 * amplitude}:ih-${2 * amplitude}`;
  const jitterX = `${amplitude}+${amplitude}*sin(t*${frequency}*2*PI)`;
  // 1.7x the x frequency keeps the two axes out of phase so the jitter reads as an irregular wobble
  // rather than the frame tracing a perfect diagonal ellipse.
  const jitterY = `${amplitude}+${amplitude}*cos(t*${frequency}*1.7*PI)`;

  return [
    { type: 'crop', value: `${cropWindow}:${jitterX}:${jitterY}` },
    { type: 'scale', value: ctx.scale },
  ];
}

/**
 * Rhythmic zoom pulse: the zoom factor oscillates between 1 and `intensity` at `frequency` Hz, centred on
 * the frame, through the same exact sub-pixel zoom as Ken Burns (fps conform first for real footage).
 */
function pulseToFilters(effect: PulseEffect, ctx: MotionContext): Filter[] {
  const intensity = effect.intensity ?? 1.08;
  const frequency = effect.frequency ?? 1;
  const amplitude = (intensity - 1).toFixed(3);

  return exactZoom({ zoom: `1+${amplitude}*0.5*(1+sin(2*PI*${frequency}*${ZOOM_TIME}))` }, ctx);
}

const MOTION_HANDLERS: Record<string, (effect: MotionEffect, ctx: MotionContext) => Filter[]> = {
  kenburns: (effect, ctx) => kenburnsToFilters(effect as KenBurnsEffect, ctx),
  rotate: (effect) => rotateToFilters(effect as RotateEffect),
  crop: (effect) => cropToFilters(effect as CropEffect),
  flip: (effect) => flipToFilters(effect as FlipEffect),
  shake: (effect, ctx) => shakeToFilters(effect as ShakeEffect, ctx),
  pulse: (effect, ctx) => pulseToFilters(effect as PulseEffect, ctx),
};

/**
 * Translates an array of MotionEffect descriptors into an array of Filter objects.
 * Multiple effects are concatenated in array order.
 * Returns [] for undefined or empty motion array.
 */
export function motionToFilters(motion: MotionEffect[] | undefined, ctx: MotionContext): Filter[] {
  if (!motion || motion.length === 0) {
    return [];
  }

  const filters: Filter[] = [];

  for (const effect of motion) {
    filters.push(...MOTION_HANDLERS[effect.type](effect, ctx));
  }

  return filters;
}
