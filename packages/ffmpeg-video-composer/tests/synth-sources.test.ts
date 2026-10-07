import { describe, expect, it } from 'vitest';
import { SYNTH_RATE } from '@/core/audio/synth/bounds';
import { tone } from '@/core/audio/synth/oscillator';
import { noise } from '@/core/audio/synth/noise';
import { strike } from '@/core/audio/synth/strike';
import { seededRandom } from '@/core/determinism/hash';

// The synth's sources, checked against what they must be analytically: a sine's zero crossings, a sweep's
// period at both ends, noise colour by its spectral tilt, a strike's decay.

function crossings(buffer: Float64Array, from = 0, to = buffer.length): number {
  let count = 0;

  for (let i = from + 1; i < to; i++) {
    if ((buffer[i - 1] < 0 && buffer[i] >= 0) || (buffer[i - 1] >= 0 && buffer[i] < 0)) count++;
  }

  return count;
}

function rms(buffer: Float64Array, from = 0, to = buffer.length): number {
  let sum = 0;

  for (let i = from; i < to; i++) sum += buffer[i] * buffer[i];

  return Math.sqrt(sum / (to - from));
}

/** Energy of the first difference relative to the signal: high for bright noise, low for dark noise. */
function brightness(buffer: Float64Array): number {
  let diff = 0;
  let total = 0;

  for (let i = 1; i < buffer.length; i++) {
    diff += (buffer[i] - buffer[i - 1]) ** 2;
    total += buffer[i] ** 2;
  }

  return diff / total;
}

describe('synth tone', () => {
  it('a 440 Hz sine crosses zero 880 times a second', () => {
    const sine = tone({ samples: SYNTH_RATE, wave: 'sine', pitch: 440 });

    expect(sine).toHaveLength(SYNTH_RATE);
    expect(Math.abs(crossings(sine) - 880)).toBeLessThanOrEqual(1);
    expect(Math.max(...sine)).toBeCloseTo(1, 3);
  });

  it('every wave stays within [-1, 1] and keeps the pitch', () => {
    for (const wave of ['sine', 'triangle', 'square', 'saw'] as const) {
      const buffer = tone({ samples: SYNTH_RATE / 2, wave, pitch: 200 });
      const peak = Math.max(...buffer.map(Math.abs));

      expect(peak, wave).toBeLessThanOrEqual(1.0001);
      expect(Math.abs(crossings(buffer) / 0.5 - 400), wave).toBeLessThanOrEqual(4);
    }
  });

  it('sweeps from one pitch to the other, exponentially by default', () => {
    const sweep = tone({ samples: SYNTH_RATE, wave: 'sine', pitch: { from: 1000, to: 100 } });
    const tenth = SYNTH_RATE / 10;
    const head = crossings(sweep, 0, tenth) * 5;
    const tail = crossings(sweep, SYNTH_RATE - tenth) * 5;

    expect(head).toBeGreaterThan(700);
    expect(tail).toBeLessThan(140);
    // Exponential: the midpoint is the geometric mean (316 Hz), linear would be 550 Hz.
    const mid = crossings(sweep, SYNTH_RATE / 2 - tenth / 2, SYNTH_RATE / 2 + tenth / 2) * 5;
    const linear = tone({ samples: SYNTH_RATE, wave: 'sine', pitch: { from: 1000, to: 100, curve: 'linear' } });
    const linearMid = crossings(linear, SYNTH_RATE / 2 - tenth / 2, SYNTH_RATE / 2 + tenth / 2) * 5;

    expect(Math.abs(mid - 316)).toBeLessThan(30);
    expect(Math.abs(linearMid - 550)).toBeLessThan(30);
  });

  it('vibrato wobbles the pitch around its centre', () => {
    const plain = tone({ samples: SYNTH_RATE, wave: 'sine', pitch: 440 });
    const wobbly = tone({ samples: SYNTH_RATE, wave: 'sine', pitch: 440, vibrato: { rate: 5, depth: 1 } });

    expect(Math.abs(crossings(wobbly) - 880)).toBeLessThan(10);
    expect(wobbly).not.toEqual(plain);
  });
});

describe('synth noise', () => {
  it('is the same stream for the same seed and another for another seed', () => {
    const a = noise(4800, 'white', seededRandom(7));
    const b = noise(4800, 'white', seededRandom(7));
    const c = noise(4800, 'white', seededRandom(8));

    expect(a).toEqual(b);
    expect(c).not.toEqual(a);
  });

  it('stays within [-1, 1] and darkens from white to pink to brown', () => {
    const colors = (['white', 'pink', 'brown'] as const).map((color) => noise(SYNTH_RATE, color, seededRandom(3)));

    for (const buffer of colors) {
      expect(Math.max(...buffer.map(Math.abs))).toBeLessThanOrEqual(1);
      expect(rms(buffer)).toBeGreaterThan(0.05);
    }

    const [white, pink, brown] = colors.map(brightness);

    expect(white).toBeGreaterThan(pink * 2);
    expect(pink).toBeGreaterThan(brown * 2);
  });
});

describe('synth strike', () => {
  it('attacks fast, rings at the pitch and decays by `ring`', () => {
    const note = strike({ samples: SYNTH_RATE, pitch: 440, ring: 0.5, random: seededRandom(1) });
    const ms = SYNTH_RATE / 1000;

    // Peak inside the first 10 ms.
    let peakAt = 0;

    for (let i = 0; i < note.length; i++) if (Math.abs(note[i]) > Math.abs(note[peakAt])) peakAt = i;

    expect(peakAt).toBeLessThan(10 * ms);
    // About -60 dB after `ring` seconds.
    expect(rms(note, 0.45 * SYNTH_RATE, 0.55 * SYNTH_RATE) / rms(note, 0, 20 * ms)).toBeLessThan(0.003);
    expect(Math.abs(crossings(note, 20 * ms, 120 * ms) / 0.1 - 880)).toBeLessThan(20);
  });

  it('adds a seeded click transient on demand', () => {
    const plain = strike({ samples: 4800, pitch: 300, ring: 0.3, random: seededRandom(1) });
    const clicked = strike({ samples: 4800, pitch: 300, ring: 0.3, click: 1, random: seededRandom(1) });

    expect(clicked).not.toEqual(plain);
    expect(clicked.slice(2400)).toEqual(plain.slice(2400));
  });
});

describe('synth glides', () => {
  it('reaches the sweep target after `time` seconds and holds it', () => {
    const glide = tone({ samples: SYNTH_RATE, wave: 'sine', pitch: { from: 1000, to: 200, time: 0.1 } });
    const tail = crossings(glide, SYNTH_RATE / 2) * 2;

    expect(Math.abs(tail / 2 - 200)).toBeLessThan(4);
    expect(crossings(glide, 0, SYNTH_RATE / 50) * 50).toBeGreaterThan(1500);
  });
});
