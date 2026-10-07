// Whole-sound effects that work one channel at a time, all in place: `saturate` (a tanh soft clip whose
// drive grows with the amount, rescaled so a full-scale input still peaks at 1), `crush` (fewer bits and a
// sample-and-hold rate drop) and `echo` (a feedback delay). The room reverb lives in room.ts. Pure.

import { SYNTH_RATE } from './bounds';
import { clamp } from './sweep';
import type { Echo } from './types';

export const DEFAULT_ECHO_TIME = 0.18;
export const DEFAULT_ECHO_FEEDBACK = 0.35;

export function saturate(buffer: Float64Array, amount: number): Float64Array {
  if (amount <= 0) return buffer;

  const drive = 1 + 9 * clamp(amount, 0, 1);
  const ceiling = Math.tanh(drive);

  for (let i = 0; i < buffer.length; i++) buffer[i] = Math.tanh(drive * buffer[i]) / ceiling;

  return buffer;
}

export function crush(buffer: Float64Array, amount: number): Float64Array {
  if (amount <= 0) return buffer;

  const level = clamp(amount, 0, 1);
  const steps = 2 ** (Math.round(16 - 12 * level) - 1);
  const hold = 1 + Math.floor(7 * level);
  let held = 0;

  for (let i = 0; i < buffer.length; i++) {
    if (i % hold === 0) held = Math.round(buffer[i] * steps) / steps;

    buffer[i] = held;
  }

  return buffer;
}

/** A number is the mix with the default time and feedback. */
export function echoSpec(value: number | Echo): Required<Echo> {
  const spec = typeof value === 'number' ? { mix: value } : value;

  return {
    mix: clamp(spec.mix, 0, 1),
    time: clamp(spec.time ?? DEFAULT_ECHO_TIME, 0.02, 1),
    feedback: clamp(spec.feedback ?? DEFAULT_ECHO_FEEDBACK, 0, 0.8),
  };
}

export function echo(buffer: Float64Array, value: number | Echo): Float64Array {
  const spec = echoSpec(value);
  const delay = Math.round(spec.time * SYNTH_RATE);

  if (spec.mix <= 0 || delay >= buffer.length) return buffer;

  const line = new Float64Array(buffer.length);

  for (let i = delay; i < buffer.length; i++) {
    line[i] = buffer[i - delay] + spec.feedback * line[i - delay];
  }

  for (let i = delay; i < buffer.length; i++) buffer[i] += spec.mix * line[i];

  return buffer;
}
