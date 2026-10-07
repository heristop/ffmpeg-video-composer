// The gain envelope of one note: an attack to 1, a hold, a decay to `sustain`, the sustain held until the
// note's end minus `release`, then the release to 0. Every stage is exponential by default (a curve
// normalised to reach its target exactly: the attack swells, the decay and release fall fast then
// linger), linear on request. A decay left out fills the note.
// Pure.

import { DEFAULT_ATTACK, SYNTH_RATE } from './bounds';
import type { Curve, Envelope } from './types';

const EXP_DEPTH = 5;
const EXP_FLOOR = Math.exp(-EXP_DEPTH);

/** Falls from 1 at x = 0 to 0 at x = 1. */
function fall(x: number, curve: Curve): number {
  if (curve === 'linear') return 1 - x;

  return (Math.exp(-EXP_DEPTH * x) - EXP_FLOOR) / (1 - EXP_FLOOR);
}

/** Rises from 0 at x = 0 to 1 at x = 1: a straight line, or a swell that saves its growth for the end. */
function rise(x: number, curve: Curve): number {
  if (curve === 'linear') return x;

  return (Math.exp(EXP_DEPTH * x) - 1) / (Math.exp(EXP_DEPTH) - 1);
}

interface Stages {
  attack: number;
  hold: number;
  decay: number;
  sustain: number;
  release: number;
  curve: Curve;
}

function stages(samples: number, spec: Envelope): Stages {
  const attack = Math.round((spec.attack ?? DEFAULT_ATTACK) * SYNTH_RATE);
  const hold = Math.round((spec.hold ?? 0) * SYNTH_RATE);
  const release = Math.round((spec.release ?? 0) * SYNTH_RATE);
  const rest = Math.max(0, samples - attack - hold - release);
  const decay = spec.decay === undefined ? rest : Math.round(spec.decay * SYNTH_RATE);

  return { attack, hold, decay, sustain: spec.sustain ?? 0, release, curve: spec.curve ?? 'exp' };
}

// The level before the release starts.
function bodyAt(i: number, s: Stages): number {
  if (i < s.attack) return rise(i / s.attack, s.curve);

  const intoDecay = i - s.attack - s.hold;

  if (intoDecay < 0) return 1;

  if (intoDecay >= s.decay) return s.sustain;

  return s.sustain + (1 - s.sustain) * fall(intoDecay / s.decay, s.curve);
}

/** The gain (0..1) of each of a note's `samples`. */
export function envelope(samples: number, spec: Envelope): Float64Array {
  const s = stages(samples, spec);
  const out = new Float64Array(samples);
  const releaseAt = samples - s.release;
  const releaseFrom = s.release > 0 ? bodyAt(Math.max(0, releaseAt), s) : 0;

  for (let i = 0; i < samples; i++) {
    out[i] = i < releaseAt ? bodyAt(i, s) : releaseFrom * fall((i - releaseAt) / s.release, s.curve);
  }

  return out;
}

/** Seconds a note lasts by its envelope alone, or null when the envelope sustains (it fills the note). */
export function envelopeLength(spec: Envelope): number | null {
  if (spec.decay === undefined || (spec.sustain ?? 0) > 0) return null;

  return (spec.attack ?? DEFAULT_ATTACK) + (spec.hold ?? 0) + spec.decay + (spec.release ?? 0);
}
