// What the stroke lowerings share (stroke-graphics.ts, stroke-outline.ts, stroke-underline.ts): the
// resolved outline of a frame / corners graphic, even-pixel snapping, warnings and sprite registration.

import type { CurveFn } from '@/core/motion/curves';
import { spriteUrl, type SpriteSpec } from './fx-sprites';
import type { Rect } from './graphics-spec';
import type { StrokePhase } from './stroke-timeline';
import type { StrokeRequest } from './sugar-context';

export const SMOOTH = 'cubic-bezier(0.4, 0, 0.2, 1)';

export type OutlineRequest = StrokeRequest & { graphic: { type: 'frame' | 'corners' } };

/** Everything the frame and corners plans share, resolved from the request. */
export interface Outline {
  request: OutlineRequest;
  box: Rect;
  thickness: number;
  radius: number;
  fps: number;
  curve: CurveFn;
  smooth: CurveFn;
  entrance: StrokePhase;
  exit: StrokePhase | null;
  exitKind: 'none' | 'fade' | 'retract' | 'expand';
  end: number | undefined;
}

/** The doctrine's minimum gap between a decoration and what it frames. */
export const DEFAULT_CLEARANCE = 24;

export function even(value: number): number {
  return 2 * Math.round(value / 2);
}

export function warn(request: StrokeRequest, code: string, message: string): void {
  request.ctx.masks?.warn(`[${code}] graphics[${request.index}] ${request.graphic.type}: ${message}`);
}

/** Registers a compile-time sprite for graphic `index` as a looped still input; null when unavailable. */
export function spriteInput(request: StrokeRequest): (key: string, spec: SpriteSpec) => string | null {
  return (key, spec) =>
    request.ctx.masks?.input(`gs${request.index}_${key}`, { url: spriteUrl(spec), still: true }) ?? null;
}

/** "#rrggbb@a" → its colour and alpha (default 1, clamped to 0..1). */
export function splitColor(color: string): { hex: string; alpha: number } {
  const [hex] = color.split('@');
  const alphaText = color.split('@').at(1);
  const alpha = alphaText === undefined ? 1 : Math.min(1, Math.max(0, Number(alphaText) || 0));

  return { hex, alpha };
}
