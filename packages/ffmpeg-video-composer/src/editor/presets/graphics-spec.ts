// Shared vocabulary of the animated graphics (editor/presets/graphics.ts): the spec a graphic type
// builds, its frame, and the drawbox / enable-window helpers every type lowers through.

import type { Filter, Section } from '@/core/types';
import type { SugarContext } from './sugar-context';
import type { Graphic } from '../../schemas/graphics.schemas';
import type { EasingSpec } from '@/core/motion/easing';
import { fmt } from '@/core/motion/hermite';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Frame {
  width: number;
  height: number;
  fps: number;
}

/** Per-render inputs a procedural graphic needs: its seed, derived from global.seed and its path. */
export interface GraphicEnv {
  seed: number;
  /** Where the graphic sits (fx graphics resolve targets and lower through ctx.masks.effects). */
  site?: { section: Section; ctx: SugarContext; index: number };
}

/** When a graphic plays: its resolved start, and when it disappears (undefined: holds to the cut). */
export interface GraphicWindow {
  at: number;
  until: number | undefined;
}

export interface Spec {
  duration: number;
  ease: EasingSpec;
  color: string;
  above: boolean;
  /** Rectangles at eased progress p. */
  rects: (p: number) => Rect[];
  /** Per-frame colour (flash decays its alpha); defaults to `color`. */
  colorAt?: (p: number) => string;
  /** False when nothing remains once the animation ends (flash, wipe). */
  holds: boolean;
  /** Filters drawn after the animated boxes (a ticker's scrolling copy). */
  extras?: (window: GraphicWindow, env: GraphicEnv) => Filter[];
  /**
   * Types that are more than boxes (pixel effects, charts, strokes) lower themselves instead; null falls
   * back to the drawbox rectangles.
   */
  render?: (window: GraphicWindow, env: GraphicEnv) => Filter[] | null;
}

export type Of<T extends Graphic['type']> = Extract<Graphic, { type: T }>;
export type Base = Pick<Spec, 'ease' | 'above' | 'holds'>;

export const BRAND = '#7C83FD';
export const INK = '#F5F3F7';
/** Most frames one animation is sampled into; longer animations step more coarsely. */
export const MAX_FRAMES = 90;

export function withAlpha(color: string, alpha: number): string {
  return `${color.split('@')[0]}@${fmt(Math.max(0, Math.min(1, alpha)))}`;
}

export function windowExpr(from: number, to?: number): string {
  return to === undefined ? `'gte(t,${fmt(from)})'` : `'gte(t,${fmt(from)})*lt(t,${fmt(to)})'`;
}

export function boxes(rects: Rect[], color: string, enable: string): Filter[] {
  // drawbox treats w/h of 0 as "full size", so empty rectangles are skipped, never emitted.
  return rects
    .filter((r) => r.w >= 1 && r.h >= 1)
    .map((r) => ({
      type: 'drawbox',
      values: { x: fmt(r.x), y: fmt(r.y), w: fmt(r.w), h: fmt(r.h), color, t: 'fill', enable },
    }));
}

/** The frame-exact sample times of one animation: `frames` steps from `at` over `duration`. */
export function sampleSteps(at: number, duration: number, fps: number): Array<{ from: number; to: number; p: number }> {
  const frames = Math.min(MAX_FRAMES, Math.max(1, Math.ceil(duration * fps)));
  const step = Math.max(1 / fps, duration / frames);

  return Array.from({ length: frames }, (_, f) => ({
    from: at + f * step,
    to: at + (f + 1) * step,
    p: (f + 1) / frames,
  }));
}

/**
 * Consecutive samples that would draw the same thing merge into one enable window: `key` names what a
 * sample draws; equal neighbours extend the previous run instead of emitting another filter.
 */
export function mergeRuns<S extends { to: number | undefined }>(samples: S[], key: (sample: S) => string): S[] {
  const runs: S[] = [];

  for (const sample of samples) {
    const last = runs.at(-1);

    if (last && key(last) === key(sample)) {
      last.to = sample.to;
      continue;
    }

    runs.push({ ...sample });
  }

  return runs;
}
