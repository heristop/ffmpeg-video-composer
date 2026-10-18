// Where an element moves, as the output frame spans motion blur supersamples (motion-blur.ts). A layer moves
// between two keys of a position, scale or rotate track whose values differ; a kinetic unit moves from its
// start to its arrival and while it leaves (a wave keeps bobbing until `until`). Frames outside every span
// are drawn sharp at no extra cost. A frame's exposure opens at its own time, so a span starts one frame
// early and ends one frame late. The budget caps what one element may supersample. Inputs may be unvalidated:
// a non-finite fps or time yields no span rather than NaN frames.

import { resolveKeyTimes, type TrackKey } from '@/core/motion/tracks';
import type { LayerAnimate } from '../../schemas/layer-animate.schemas';

/** Output frames `first..last`, inclusive. */
export interface Span {
  first: number;
  last: number;
}

export interface UnitTiming {
  start: number;
  arrive: number;
  leave: { at: number; duration: number } | null;
}

/** Most spans one element supersamples; the nearest are joined first. */
export const MAX_SPANS = 4;
/** Most supersampled frames one element may add: e.g. 3 s of motion at 30 fps × 16 samples. */
export const MAX_BLUR_FRAMES = 1440;

const MOVING_TRACKS = ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotate'] as const;

type Window = [number, number];

// The key windows of a track whose value changes, in seconds.
function movingWindows(keys: readonly TrackKey[]): Window[] {
  const timed = resolveKeyTimes(keys);

  return timed.slice(1).flatMap((key, i): Window[] => {
    if (String(key.v) === String(timed[i].v)) return [];

    return [[timed[i].at, key.at]];
  });
}

function spansOf(windows: readonly Window[], fps: number): Span[] {
  if (!Number.isFinite(fps) || fps <= 0) return [];

  return mergeSpans(
    windows
      .filter(([from, to]) => Number.isFinite(from) && Number.isFinite(to) && to >= from)
      .map(([from, to]) => ({ first: Math.max(0, Math.floor(from * fps) - 1), last: Math.ceil(to * fps) + 1 }))
  );
}

export function mergeSpans(spans: readonly Span[], max = MAX_SPANS): Span[] {
  const limit = Number.isFinite(max) && max >= 1 ? Math.floor(max) : MAX_SPANS;
  const sound = spans.filter(
    (span) => Number.isFinite(span.first) && Number.isFinite(span.last) && span.last >= span.first
  );
  const joined: Span[] = [];

  for (const span of sound.toSorted((a, b) => a.first - b.first)) {
    const current = joined.at(-1);

    if (current && span.first <= current.last + 1) {
      current.last = Math.max(current.last, span.last);
      continue;
    }

    joined.push({ ...span });
  }

  return joined.length > limit ? closeNearestGaps(joined, joined.length - limit) : joined;
}

// Joins across the `count` smallest gaps (earliest first on ties) in one pass: gaps do not change as others close.
function closeNearestGaps(joined: readonly Span[], count: number): Span[] {
  const gaps = joined.slice(1).map((span, i) => ({ i, size: span.first - joined[i].last }));
  const closed = new Set(
    gaps
      .toSorted((a, b) => a.size - b.size || a.i - b.i)
      .slice(0, count)
      .map((gap) => gap.i)
  );
  let tail: Span = { ...joined[0] };
  const result: Span[] = [tail];

  for (const [i, span] of joined.slice(1).entries()) {
    if (closed.has(i)) {
      tail.last = span.last;
      continue;
    }

    tail = { ...span };
    result.push(tail);
  }

  return result;
}

/** The spans where a layer's position, scale or rotation changes. */
export function layerSpans(animate: LayerAnimate | undefined, fps: number): Span[] {
  const windows = MOVING_TRACKS.flatMap((track) => {
    const keys = animate?.[track];

    return keys ? movingWindows(keys) : [];
  });

  return spansOf(windows, fps);
}

/** The spans where kinetic units travel: entrances (to `until` when they keep moving) and exits. */
export function unitSpans(timings: readonly UnitTiming[], fps: number, until: number | null): Span[] {
  const windows = timings.flatMap((timing): Window[] => {
    const end = until !== null && Number.isFinite(until) ? Math.max(until, timing.arrive) : timing.arrive;
    const entrance: Window = [timing.start, end];

    return timing.leave ? [entrance, [timing.leave.at, timing.leave.at + timing.leave.duration]] : [entrance];
  });

  return spansOf(windows, fps);
}

/**
 * Spans cut to a section's frames: motion keyed past the cut is never rendered, so it must not spend the
 * budget. An unknown length (not above 0) keeps the spans as they are.
 */
export function clipSpans(spans: readonly Span[], frames: number): Span[] {
  if (!Number.isFinite(frames) || frames <= 0) return [...spans];

  return spans
    .filter((span) => span.first < frames)
    .map((span) => ({ first: span.first, last: Math.min(span.last, frames - 1) }));
}

/** The samples an element can afford over its spans; 0 = no blur. `capped` when fewer than requested. */
export function affordableSamples(spans: readonly Span[], requested: number): { samples: number; capped: boolean } {
  const frames = spans.reduce((sum, span) => sum + span.last - span.first + 1, 0);

  if (frames === 0) return { samples: 0, capped: false };

  if (!Number.isFinite(frames) || !Number.isFinite(requested)) return { samples: 0, capped: true };

  const samples = Math.min(Math.floor(requested), Math.floor(MAX_BLUR_FRAMES / frames));

  if (samples < 2) return { samples: 0, capped: true };

  return { samples, capped: samples < requested };
}
