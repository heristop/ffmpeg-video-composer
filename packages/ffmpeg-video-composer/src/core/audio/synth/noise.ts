// Seeded noise in three colours: white (flat), pink (-3 dB/octave, Paul Kellet's economy filter) and brown
// (-6 dB/octave, a leaky integrator). The stream comes from the caller's seeded PRNG, so the same seed
// always draws the same noise. Scaled to roughly full scale and clamped to [-1, 1]. Pure.

import { clamp } from './sweep';
import type { NoiseColor } from './types';

type Draw = (white: number) => number;

function pinkFilter(): Draw {
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;

  return (white) => {
    b0 = 0.99765 * b0 + white * 0.099046;
    b1 = 0.963 * b1 + white * 0.2965164;
    b2 = 0.57 * b2 + white * 1.0526913;

    return (b0 + b1 + b2 + white * 0.1848) * 0.3;
  };
}

function brownFilter(): Draw {
  let last = 0;

  return (white) => {
    last = (last + 0.02 * white) / 1.02;

    return last * 3.5;
  };
}

function colorFilter(color: NoiseColor): Draw {
  if (color === 'pink') return pinkFilter();

  if (color === 'brown') return brownFilter();

  return (white) => white;
}

/** `samples` of `color` noise drawn from `random` (floats in [0, 1)). */
export function noise(samples: number, color: NoiseColor, random: () => number): Float64Array {
  const out = new Float64Array(samples);
  const draw = colorFilter(color);

  for (let i = 0; i < samples; i++) {
    out[i] = clamp(draw(random() * 2 - 1), -1, 1);
  }

  return out;
}
