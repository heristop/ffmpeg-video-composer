// When a repeated layer's hits land: `repeat` hits, the first at 0, each interval `every` seconds times
// (1 - accelerate) to the power of its index (a roll speeding up, or slowing down when negative). `jitter`
// moves each later hit by up to ±jitter/2 of its interval, never late enough to pass the next hit, and
// lowers its level by up to 30 % · jitter, drawn from the layer's seeded stream so it never sounds
// mechanical yet always renders the same. Pure.

import { MAX_REPEAT } from './bounds';
import { clamp } from './sweep';
import type { Sequence } from './types';

export interface Hit {
  /** Seconds after the layer starts. */
  time: number;
  gain: number;
}

const JITTER_LEVEL = 0.3;
/** Share of the next gap a hit may move late (under the 0.5 the next hit may move early). */
const AHEAD = 0.49;

function round(value: number): number {
  return Number(value.toFixed(9));
}

/** The intervals between consecutive hits, seconds. */
export function intervals(spec: Sequence): number[] {
  const count = clamp(Math.round(spec.repeat ?? 1), 1, MAX_REPEAT);
  const ratio = 1 - clamp(spec.accelerate ?? 0, -1, 0.9);
  const every = spec.every ?? 0.1;

  return Array.from({ length: count - 1 }, (_, k) => every * ratio ** k);
}

/** Each hit of the layer, in order. */
export function onsets(spec: Sequence, random: () => number): Hit[] {
  const jitter = clamp(spec.jitter ?? 0, 0, 1);
  const gaps = intervals(spec);
  const hits: Hit[] = [{ time: 0, gain: 1 }];
  let cursor = 0;

  for (const [k, interval] of gaps.entries()) {
    cursor += interval;

    if (jitter === 0) {
      hits.push({ time: round(cursor), gain: 1 });
      continue;
    }

    const shift = (random() - 0.5) * jitter * interval;
    const gain = 1 - JITTER_LEVEL * jitter * random();
    // The next hit can come as early as half the next gap before its place: a later shift stops short of
    // that, so an accelerating roll keeps its hits in order.
    const latest = AHEAD * (gaps.at(k + 1) ?? interval);

    hits.push({ time: round(Math.max(0, cursor + Math.min(shift, latest))), gain });
  }

  return hits;
}
