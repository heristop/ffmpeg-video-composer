// Tone oscillators: sine, triangle, square and saw by phase accumulation, so a swept or vibrato pitch stays
// continuous. Square and saw are band-limited with PolyBLEP (no aliasing whistle on high notes); the
// triangle's harmonics fall fast enough to stay naive. Every wave starts at 0. Pure.

import { MAX_PITCH, MIN_PITCH, SYNTH_RATE } from './bounds';
import { clamp, sweepAt } from './sweep';
import type { Pitch, Vibrato, Wave } from './types';

export interface ToneSpec {
  samples: number;
  wave?: Wave;
  pitch: Pitch;
  vibrato?: Vibrato;
}

// The PolyBLEP residual smoothing the step at phase 0 (t in [0, 1), dt the phase step).
function blep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;

    return x + x - x * x - 1;
  }

  if (t > 1 - dt) {
    const x = (t - 1) / dt;

    return x * x + x + x + 1;
  }

  return 0;
}

function square(phase: number, dt: number): number {
  const naive = phase < 0.5 ? 1 : -1;

  return naive + blep(phase, dt) - blep((phase + 0.5) % 1, dt);
}

function saw(phase: number, dt: number): number {
  return 2 * phase - 1 - blep(phase, dt);
}

function frequencyAt(spec: ToneSpec, i: number): number {
  const base = sweepAt(spec.pitch, i, spec.samples);
  const vibrato = spec.vibrato;
  const wobble = vibrato ? 2 ** ((vibrato.depth / 12) * Math.sin((2 * Math.PI * vibrato.rate * i) / SYNTH_RATE)) : 1;

  return clamp(base * wobble, MIN_PITCH, MAX_PITCH);
}

/** `samples` of a tone at full scale. */
export function tone(spec: ToneSpec): Float64Array {
  const out = new Float64Array(spec.samples);
  const wave = spec.wave ?? 'sine';
  let phase = 0;

  for (let i = 0; i < spec.samples; i++) {
    const dt = frequencyAt(spec, i) / SYNTH_RATE;

    out[i] = sample(wave, phase, dt);
    phase = (phase + dt) % 1;
  }

  return out;
}

function sample(wave: Wave, phase: number, dt: number): number {
  if (wave === 'square') return square(phase, dt);

  if (wave === 'saw') return saw(phase, dt);

  if (wave === 'triangle') return 1 - 4 * Math.abs(((phase + 0.25) % 1) - 0.5);

  return Math.sin(2 * Math.PI * phase);
}
