// Biquad filters (RBJ cookbook lowpass/highpass, 12 dB/octave), the cutoff fixed or swept over the note.
// A bandpass is a cascade: a highpass half an octave under the centre, then a lowpass half an octave over
// it, each run twice for 24 dB/octave skirts. A swept filter recomputes its coefficients every few
// samples. The cutoff is clamped under Nyquist and the resonance to 0.5..12, so it never blows up. Pure.

import { DEFAULT_RESONANCE, MAX_CUTOFF, MAX_RESONANCE, MIN_CUTOFF, MIN_RESONANCE, SYNTH_RATE } from './bounds';
import { clamp, cutoffOf, sweepAt } from './sweep';
import type { Filter, Pitch } from './types';

type Pass = 'lowpass' | 'highpass';

interface Stage {
  pass: Pass;
  cutoff: Pitch;
  /** Cutoff multiplier (the bandpass offsets its two halves). */
  scale: number;
  q: number;
}

const STEP = 16;
const NYQUIST_GUARD = 0.45 * SYNTH_RATE;

function coefficients(pass: Pass, frequency: number, q: number): Float64Array {
  const w = (2 * Math.PI * clamp(frequency, MIN_CUTOFF, Math.min(MAX_CUTOFF, NYQUIST_GUARD))) / SYNTH_RATE;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const edge = pass === 'lowpass' ? (1 - cos) / 2 : (1 + cos) / 2;
  const middle = pass === 'lowpass' ? 1 - cos : -(1 + cos);

  return Float64Array.from([edge / a0, middle / a0, edge / a0, (-2 * cos) / a0, (1 - alpha) / a0]);
}

function run(buffer: Float64Array, stage: Stage): void {
  const swept = typeof stage.cutoff !== 'number';
  let c = coefficients(stage.pass, sweepAt(stage.cutoff, 0, buffer.length) * stage.scale, stage.q);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;

  for (let i = 0; i < buffer.length; i++) {
    if (swept && i % STEP === 0) {
      c = coefficients(stage.pass, sweepAt(stage.cutoff, i, buffer.length) * stage.scale, stage.q);
    }

    const x = buffer[i];
    const y = c[0] * x + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;

    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    buffer[i] = y;
  }
}

function stagesOf(spec: Filter): Stage[] {
  const cutoff = cutoffOf(spec);
  const q = clamp(spec.resonance ?? DEFAULT_RESONANCE, MIN_RESONANCE, MAX_RESONANCE);

  if (spec.type !== 'bandpass') return [{ pass: spec.type, cutoff, scale: 1, q }];

  const low: Stage = { pass: 'highpass', cutoff, scale: Math.SQRT1_2, q: DEFAULT_RESONANCE };
  const high: Stage = { pass: 'lowpass', cutoff, scale: Math.SQRT2, q };

  return [low, low, high, high];
}

/** Filters `buffer` in place through `spec` (or each filter of a chain in turn) and returns it. */
export function filter(buffer: Float64Array, spec: Filter | readonly Filter[]): Float64Array {
  const chain: readonly Filter[] = Array.isArray(spec) ? spec : [spec as Filter];

  for (const stage of chain.flatMap(stagesOf)) run(buffer, stage);

  return buffer;
}
