// A value that is fixed or sweeps over a note (pitch, filter cutoff). Exponential sweeps move by equal
// ratios, which is how pitch and cutoff are heard; linear ones by equal steps. A sweep with a `time` glides
// over that many seconds and then holds its target (a drum's pitch drop, a drip's bloop); without one it
// spans the whole note. Pure.

import { SYNTH_RATE } from './bounds';
import type { Curve, Pitch } from './types';

/** The value at sample `i` of a note `samples` long. */
export function sweepAt(value: Pitch, i: number, samples: number): number {
  if (typeof value === 'number') return value;

  const span = value.time === undefined ? Math.max(1, samples - 1) : Math.max(1, value.time * SYNTH_RATE);
  const x = Math.min(1, i / span);

  if ((value.curve ?? 'exp') === 'linear') return value.from + (value.to - value.from) * x;

  return value.from * (value.to / value.from) ** x;
}

/** A filter's cutoff spec as a sweepable value: `cutoff`, else `from` → `to`. */
export function cutoffOf(spec: { cutoff?: number; from?: number; to?: number; curve?: Curve; time?: number }): Pitch {
  if (spec.cutoff !== undefined) return spec.cutoff;

  const from = spec.from ?? spec.to ?? 1000;

  return { from, to: spec.to ?? from, curve: spec.curve, time: spec.time };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
