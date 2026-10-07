// The library sounds for interface moments — clicks, ticks, pops, bells and blips — re-expressed in the
// sound vocabulary (same conventions as recipes-motion.ts). A lavfi `strike(on, f, k, partials)` becomes a
// `strike` layer delayed by `on`, ringing ln(1000)/k seconds, with the same partials. Pure data.

import type { ComposedSound } from '../synth/types';

const BELL = [
  { ratio: 1, gain: 1 },
  { ratio: 2, gain: 0.2 },
];

export const UI_RECIPES = {
  click: {
    length: 0.05,
    layers: [
      {
        source: 'noise',
        filter: { type: 'highpass', cutoff: 2000 },
        envelope: { attack: 0.0005, decay: 0.02 },
      },
    ],
  },
  tick: {
    length: 0.06,
    layers: [{ source: 'tone', pitch: 2100, envelope: { attack: 0.0005, decay: 0.056 } }],
  },
  pop: {
    length: 0.15,
    layers: [
      {
        source: 'tone',
        pitch: { from: 320, to: 1120, curve: 'linear' },
        length: 0.15,
        envelope: { attack: 0.0025, decay: 0.18 },
      },
    ],
  },
  shutter: {
    length: 0.25,
    layers: [
      {
        source: 'noise',
        filter: { type: 'bandpass', cutoff: 3200, resonance: 1.2 },
        envelope: { attack: 0.0005, decay: 0.05 },
      },
      {
        source: 'noise',
        gain: 0.9,
        delay: 0.11,
        filter: { type: 'bandpass', cutoff: 2600, resonance: 1.2 },
        envelope: { attack: 0.0005, decay: 0.09 },
      },
    ],
  },
  ding: {
    length: 1.5,
    layers: [
      {
        source: 'strike',
        pitch: 1318.5,
        ring: 2.3,
        partials: [
          { ratio: 1, gain: 1 },
          { ratio: 2, gain: 0.3 },
          { ratio: 3, gain: 0.1 },
        ],
        envelope: { attack: 0, hold: 1.2, decay: 0.3, curve: 'linear' },
      },
    ],
  },
  glitch: {
    length: 0.4,
    layers: [200, 600, 1100].map((pitch, i) => ({
      source: 'tone' as const,
      wave: 'square' as const,
      pitch,
      gain: 0.7 - 0.15 * i,
      delay: i * 0.009,
      repeat: 12,
      every: 0.0333,
      jitter: 0.9,
      length: 0.016,
      envelope: { attack: 0.0007, sustain: 1, release: 0.0007, curve: 'linear' as const },
    })),
    fx: { crush: 0.75 },
  },
  sparkle: {
    length: 1.2,
    layers: [
      ...[
        [0, 2093, 1, 1],
        [0.05, 2637, 0.99, 0.8],
        [0.1, 3136, 0.86, 0.7],
        [0.16, 4186, 0.77, 0.6],
        [0.23, 5274, 0.69, 0.5],
      ].map(([delay, pitch, ring, gain]) => ({ source: 'strike' as const, pitch, ring, gain, delay, partials: BELL })),
      {
        source: 'noise',
        gain: 0.15,
        filter: { type: 'highpass', cutoff: 7000 },
        envelope: { attack: 0.05, decay: 0.6 },
      },
    ],
  },
  notification: {
    length: 0.8,
    layers: [
      {
        source: 'strike',
        pitch: 784,
        ring: 0.77,
        partials: [
          { ratio: 1, gain: 1 },
          { ratio: 4, gain: 0.25 },
        ],
      },
      {
        source: 'strike',
        pitch: 1175,
        ring: 0.67,
        delay: 0.13,
        partials: [
          { ratio: 1, gain: 1 },
          { ratio: 4, gain: 0.2 },
        ],
      },
    ],
  },
  keystroke: {
    length: 0.09,
    layers: [
      {
        source: 'noise',
        filter: { type: 'bandpass', cutoff: 3800, resonance: 1.2 },
        envelope: { attack: 0.0005, decay: 0.03 },
      },
      { source: 'tone', pitch: 230, gain: 0.3, envelope: { attack: 0.0005, decay: 0.045 } },
      { source: 'tone', pitch: 1700, gain: 0.35, delay: 0.03, envelope: { attack: 0.0005, decay: 0.028 } },
    ],
  },
  blip: {
    length: 0.12,
    layers: [
      {
        source: 'tone',
        pitch: { from: 900, to: 1620, curve: 'linear' },
        drive: 0.15,
        filter: { type: 'lowpass', cutoff: 6000 },
        length: 0.12,
        envelope: { attack: 0.001, decay: 0.23, release: 0.02 },
      },
    ],
  },
  coin: {
    length: 0.6,
    layers: [
      {
        source: 'tone',
        pitch: 988,
        drive: 0.1,
        filter: { type: 'lowpass', cutoff: 9000 },
        length: 0.07,
        envelope: { attack: 0.0013, sustain: 1, release: 0.0013, curve: 'linear' },
      },
      {
        source: 'tone',
        pitch: 1319,
        drive: 0.1,
        delay: 0.07,
        filter: { type: 'lowpass', cutoff: 9000 },
        length: 0.53,
        envelope: { attack: 0.0013, decay: 0.83, release: 0.15 },
      },
    ],
  },
} satisfies Record<string, ComposedSound>;
