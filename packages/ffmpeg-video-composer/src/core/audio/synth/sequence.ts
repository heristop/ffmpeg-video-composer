// When a repeated layer's hits land: `repeat` hits, the first at 0, each interval `every` seconds times
// (1 - accelerate) to the power of its index (a roll speeding up, or slowing down when negative). `jitter`
// moves each later hit by up to ±jitter/2 of its interval and lowers its level by up to 30 % · jitter,
// drawn from the layer's seeded stream so it never sounds mechanical yet always renders the same. Pure.

import { MAX_REPEAT } from './bounds';
import { clamp } from './sweep';
import type { Sequence } from './types';

export interface Hit {
  /** Seconds after the layer starts. */
  time: number;
  gain: number;
}

const JITTER_LEVEL = 0.3;

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
  const hits: Hit[] = [{ time: 0, gain: 1 }];
  let cursor = 0;

  for (const interval of intervals(spec)) {
    cursor += interval;

    if (jitter === 0) {
      hits.push({ time: round(cursor), gain: 1 });
      continue;
    }

    const shift = (random() - 0.5) * jitter * interval;
    const gain = 1 - JITTER_LEVEL * jitter * random();

    hits.push({ time: round(Math.max(0, cursor + shift)), gain });
  }

  return hits;
}
