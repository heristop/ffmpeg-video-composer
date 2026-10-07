// A small deterministic room: a Schroeder/Freeverb-style network (four damped feedback combs in parallel,
// two allpasses in series) per channel, the right channel's delays offset so the tail is wide. `amount`
// (0..1) grows both the decay and the wet level. No randomness, so it renders the same everywhere. Pure.

import { SYNTH_RATE } from './bounds';
import { clamp } from './sweep';

// Freeverb's tunings at 44.1 kHz, scaled to the synth rate.
const COMBS = [1116, 1188, 1277, 1356];
const ALLPASSES = [556, 441];
const STEREO_SPREAD = 23;
const DAMPING = 0.3;
const ALLPASS_GAIN = 0.5;
const SCALE = SYNTH_RATE / 44100;

/** Seconds the tail of a room at `amount` rings past the dry sound (for a derived length). */
export function roomTail(amount: number): number {
  return amount > 0 ? 0.2 + clamp(amount, 0, 1) : 0;
}

function comb(input: Float64Array, length: number, feedback: number): Float64Array {
  const out = new Float64Array(input.length);
  const line = new Float64Array(length);
  let index = 0;
  let filtered = 0;

  for (let i = 0; i < input.length; i++) {
    const delayed = line[index];

    filtered = delayed * (1 - DAMPING) + filtered * DAMPING;
    line[index] = input[i] + filtered * feedback;
    out[i] = delayed;
    index = (index + 1) % length;
  }

  return out;
}

function allpass(buffer: Float64Array, length: number): void {
  const line = new Float64Array(length);
  let index = 0;

  for (let i = 0; i < buffer.length; i++) {
    const delayed = line[index];
    const input = buffer[i];

    line[index] = input + delayed * ALLPASS_GAIN;
    buffer[i] = delayed - input;
    index = (index + 1) % length;
  }
}

function wet(dry: Float64Array, spread: number, feedback: number): Float64Array {
  const sum = new Float64Array(dry.length);

  for (const tuning of COMBS) {
    const out = comb(dry, Math.round((tuning + spread) * SCALE), feedback);

    for (let i = 0; i < sum.length; i++) sum[i] += out[i] / COMBS.length;
  }

  for (const tuning of ALLPASSES) allpass(sum, Math.round((tuning + spread) * SCALE));

  return sum;
}

/** Adds the room to both channels in place. */
export function room(left: Float64Array, right: Float64Array, amount: number): void {
  const level = clamp(amount, 0, 1);

  if (level <= 0) return;

  const feedback = 0.7 + 0.25 * level;
  const mix = 0.6 * level;
  const tails = [wet(left, 0, feedback), wet(right, STEREO_SPREAD, feedback)];

  for (let i = 0; i < left.length; i++) {
    left[i] += mix * tails[0][i];
    right[i] += mix * tails[1][i];
  }
}
