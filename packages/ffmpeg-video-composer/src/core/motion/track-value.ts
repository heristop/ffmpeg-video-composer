// A keyframe track's value at one instant, in plain numbers: the same sum of eased steps trackExpr lowers to
// an FFmpeg expression (tracks.ts), evaluated in JavaScript for what is drawn frame by frame at compile time
// (an animated HTML card's elements). Tokens and time references are already resolved; a relative value
// ("+80") is an offset from rest, so it reads as the number it carries.

import { parseEasing } from './easing';
import { resolveKeyTimes, type TimedKey, type TrackKey } from './tracks';

function numeric(value: number | string): number {
  return typeof value === 'string' ? Number(value) : value;
}

// Key `key`'s eased progress over its own window: 0 before it, 1 from its time on.
function progress(previous: TimedKey, key: TimedKey, time: number): number {
  if (time <= previous.at) return 0;

  if (time >= key.at) return 1;

  const p = (time - previous.at) / (key.at - previous.at);

  if (key.ease === undefined || key.ease === 'linear') return p;

  return parseEasing(key.ease).fn(p);
}

/** The track's value at `time` seconds: the first key's value before it, the last key's after it. */
export function trackValueAt(keys: readonly TrackKey[], time: number): number {
  const timed = resolveKeyTimes(keys);
  let value = numeric(timed[0].v);

  for (let index = 1; index < timed.length; index++) {
    const delta = numeric(timed[index].v) - numeric(timed[index - 1].v);

    if (delta !== 0) value += delta * progress(timed[index - 1], timed[index], time);
  }

  return value;
}

/** The first and last key times of a track, in seconds. */
export function trackSpan(keys: readonly TrackKey[]): { start: number; end: number } {
  const timed = resolveKeyTimes(keys);

  return { start: timed[0].at, end: (timed.at(-1) ?? timed[0]).at };
}
