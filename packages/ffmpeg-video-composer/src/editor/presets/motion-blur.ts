// Motion blur by supersampling. Over one span (motion-spans.ts), a copy of the picture is cut out (trim, on
// half-frame edges), each frame is repeated `samples` times (fps … round=down, so every sample of frame j
// holds base frame j and moving footage never ghosts), and the copy is retimed so sample i of frame j sits at
// j/fps + i/samples · shutter/360 / fps. Every downstream expression (overlay x/y, drawtext, a layer's
// rotate/scale/opacity) reads that clock. A fine timebase keeps the sub-frame times exact (the fps filter's
// 1/(fps·samples) would round them). The element is drawn on each sample, tmix averages each frame's
// samples, and the full average (the last of each group) lands back on the frame grid. The blurred frames
// are opaque, so a plain overlay replaces the sharp ones over the span and nothing is premultiplied.

import { assertFiniteNumber } from '@/core/arg-guard';
import type { Filter, FilterValues } from '@/core/filter-types';
import { fmt } from '@/core/motion/hermite';
import type { ResolvedMotionBlur } from '../../schemas/layer-composite.schemas';
import { affordableSamples, type Span } from './motion-spans';

const MIN_SAMPLES = 2;
const MAX_SAMPLES = 16;
const MAX_FPS = 1000;
const MAX_FRAME = 10_000_000;

export interface Shutter {
  fps: number;
  samples: number;
  /** Degrees, 1..360. */
  shutter: number;
}

export interface BlurPlan {
  spans: Span[];
  shutter: Shutter;
}

export const MOTION_BLUR_UNAVAILABLE_WARNING =
  '[motion_blur_unavailable] motion blur needs the tmix filter, absent from this FFmpeg build: the element is drawn sharp';

export function motionBlurCappedWarning(requested: number, samples: number): string {
  if (samples === 0) {
    return '[motion_blur_capped] the element moves for too long to supersample within the budget: drawn sharp';
  }

  return `[motion_blur_capped] ${requested} samples over this much motion exceed the budget: ${samples} used`;
}

// These strings bypass FilterManager's guards and an unvalidated template can reach them, so every number
// written into one is checked here: finite, integral where it counts frames, and within what ffmpeg takes.
function integerIn(value: unknown, field: string, min: number, max: number): number {
  const number = assertFiniteNumber(value, field);

  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`Unsafe ${field}: ${number} is not an integer from ${min} to ${max}`);
  }

  return number;
}

function checkedShutter({ fps, samples, shutter }: Shutter): Shutter {
  const rate = assertFiniteNumber(fps, 'motion blur fps');

  if (rate <= 0 || rate > MAX_FPS)
    throw new Error(`Unsafe motion blur fps: ${rate} is not above 0 and up to ${MAX_FPS}`);

  return {
    fps: rate,
    samples: integerIn(samples, 'motion blur samples', MIN_SAMPLES, MAX_SAMPLES),
    shutter: integerIn(shutter, 'motion blur shutter', 1, 360),
  };
}

/** A span on non-negative frame indices (a start before frame 0 is cut to it). */
function checkedSpan(span: Span): Span {
  const first = Math.max(0, integerIn(span.first, 'motion blur span start', -MAX_FRAME, MAX_FRAME));
  const last = integerIn(span.last, 'motion blur span end', -MAX_FRAME, MAX_FRAME);

  if (last < first) throw new Error(`Unsafe motion blur span: ends at frame ${last}, before it starts at ${first}`);

  return { first, last };
}

/** The head of a supersampled branch over `span`: cut, repeat, retime onto the shutter clock. */
export function blurHead(range: Span, clock: Shutter): string[] {
  const { fps, samples, shutter } = checkedShutter(clock);
  const span = checkedSpan(range);
  const step = fmt(shutter / 360 / samples);

  return [
    `trim=start=${fmt(Math.max(0, (span.first - 0.5) / fps))}:end=${fmt((span.last + 0.5) / fps)}`,
    `fps=${fmt(fps * samples)}:round=down`,
    `settb=1/${fmt(fps * samples * 360)}`,
    `setpts='STARTPTS+(floor(N/${samples})+mod(N,${samples})*${step})/${fmt(fps)}/TB'`,
  ];
}

/** The tail: average each frame's samples and land the full average back on the frame grid. */
export function blurTail(clock: Shutter): string[] {
  const { fps, samples } = checkedShutter(clock);

  return [`tmix=frames=${samples}`, `setpts='STARTPTS+floor(N/${samples})/${fmt(fps)}/TB'`, `fps=${fmt(fps)}`];
}

/**
 * A head/tail string as a sub-graph Filter. setpts goes through `values.expr`: FormatterManager rewrites a
 * scalar setpts value to the section speed (editor/utils/footage-lowering.ts does the same).
 */
export function asFilter(filter: string): Filter {
  const at = filter.indexOf('=');
  const type = filter.slice(0, at);
  const value = filter.slice(at + 1);

  if (type === 'setpts') return { type, values: { expr: value } as unknown as FilterValues };

  return { type, value };
}

/** The blur an element gets on this build, or null (no motion, no tmix, or no budget left). */
export function planBlur(
  spans: Span[],
  blur: ResolvedMotionBlur,
  fps: number,
  env: { has: (filter: string) => boolean; warn: (message: string) => void }
): BlurPlan | null {
  if (spans.length === 0) return null;

  if (!env.has('tmix')) {
    env.warn(MOTION_BLUR_UNAVAILABLE_WARNING);

    return null;
  }

  const shutter = checkedShutter({ fps, samples: blur.samples, shutter: blur.shutter });
  const clamped = spans.map(checkedSpan);
  const budget = affordableSamples(clamped, shutter.samples);

  if (budget.capped) env.warn(motionBlurCappedWarning(shutter.samples, budget.samples));

  if (budget.samples === 0) return null;

  return { spans: clamped, shutter: { ...shutter, samples: budget.samples } };
}
