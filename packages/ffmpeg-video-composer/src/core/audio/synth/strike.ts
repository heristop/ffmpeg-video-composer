// A struck note (mallet, bell, pluck, drum skin): a 1.7 ms attack, then each partial rings down
// exponentially, the upper ones faster (by the square root of their ratio), plus an optional seeded noise
// click at the hit. The same idea as the `strike()` helper the library recipes use
// (leclap-creative-kit/scripts/gen-sfx-sources.ts), computed in TypeScript. Pure.

import { MAX_PITCH, MIN_PITCH, SYNTH_RATE } from './bounds';
import { clamp, sweepAt } from './sweep';
import type { Pitch, StrikePartial } from './types';

export interface StrikeSpec {
  samples: number;
  pitch: Pitch;
  /** Seconds for the fundamental to fall 60 dB. */
  ring?: number;
  partials?: readonly StrikePartial[];
  click?: number;
  random: () => number;
}

/** A struck body: the fundamental, a soft octave and a faint twelfth. */
export const DEFAULT_PARTIALS: readonly StrikePartial[] = [
  { ratio: 1, gain: 1 },
  { ratio: 2, gain: 0.3 },
  { ratio: 3, gain: 0.1 },
];

const ATTACK_RATE = 600;
const CLICK_SECONDS = 0.004;
/** ln(1000): an exponential at this rate per `ring` second has fallen 60 dB. */
const SIXTY_DB = Math.log(1000);

function ringOut(spec: StrikeSpec, partials: readonly StrikePartial[], out: Float64Array): void {
  const rate = SIXTY_DB / (spec.ring ?? 0.6);
  const phases = new Float64Array(partials.length);
  const total = partials.reduce((sum, partial) => sum + partial.gain, 0) || 1;

  for (let i = 0; i < out.length; i++) {
    const t = i / SYNTH_RATE;
    const pitch = clamp(sweepAt(spec.pitch, i, out.length), MIN_PITCH, MAX_PITCH);
    let sum = 0;

    for (let k = 0; k < partials.length; k++) {
      const { ratio, gain } = partials[k];

      sum += gain * Math.exp(-rate * Math.sqrt(ratio) * t) * Math.sin(2 * Math.PI * phases[k]);
      phases[k] = (phases[k] + Math.min(0.5, (pitch * ratio) / SYNTH_RATE)) % 1;
    }

    out[i] = (Math.min(1, t * ATTACK_RATE) * sum) / total;
  }
}

function addClick(spec: StrikeSpec, out: Float64Array): void {
  const level = spec.click ?? 0;
  const length = Math.min(out.length, Math.round(CLICK_SECONDS * SYNTH_RATE));

  if (level <= 0) return;

  for (let i = 0; i < length; i++) {
    const decay = 1 - i / length;

    out[i] = clamp(out[i] + level * decay * decay * (spec.random() * 2 - 1), -1, 1);
  }
}

/** `samples` of a struck note. */
export function strike(spec: StrikeSpec): Float64Array {
  const out = new Float64Array(spec.samples);

  ringOut(spec, spec.partials && spec.partials.length > 0 ? spec.partials : DEFAULT_PARTIALS, out);
  addClick(spec, out);

  return out;
}
