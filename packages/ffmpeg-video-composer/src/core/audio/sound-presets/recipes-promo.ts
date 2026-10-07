// The library sounds for social and promo editing — claps, rolls, UI feedback, foley and fanfares —
// re-expressed in the sound vocabulary (conventions in recipes-motion.ts; the lavfi originals are in
// leclap-creative-kit/scripts/gen-sfx-recipes-promo.ts and gen-sfx.ts). Pure data.

import type { ComposedSound } from '../synth/types';

const MALLET = [
  { ratio: 1, gain: 1 },
  { ratio: 2, gain: 0.25 },
  { ratio: 3, gain: 0.06 },
];

const SNARE = {
  source: 'noise' as const,
  filter: [
    { type: 'highpass' as const, cutoff: 250 },
    { type: 'lowpass' as const, cutoff: 6000 },
  ],
  every: 1 / 24,
  repeat: 18,
  envelope: { attack: 0.004, decay: 0.06 },
};

function held(pitch: number, delay: number, length: number, gain = 1) {
  return {
    source: 'tone' as const,
    pitch,
    gain,
    delay,
    length,
    drive: 0.11,
    envelope: { attack: 0.012, sustain: 1, release: 0.012, curve: 'linear' as const },
  };
}

export const PROMO_RECIPES = {
  'drum-roll': {
    length: 1.5,
    layers: [
      { ...SNARE, gain: 0.35 },
      { ...SNARE, gain: 0.85, delay: 0.75 },
    ],
  },
  heartbeat: {
    length: 1,
    layers: [
      {
        source: 'tone',
        pitch: { from: 92, to: 52, time: 0.06 },
        drive: 0.25,
        filter: { type: 'lowpass', cutoff: 380 },
        envelope: { attack: 0.0025, decay: 0.36 },
      },
      {
        source: 'tone',
        pitch: { from: 81, to: 46, time: 0.06 },
        gain: 0.75,
        delay: 0.26,
        drive: 0.25,
        filter: { type: 'lowpass', cutoff: 380 },
        envelope: { attack: 0.0025, decay: 0.42 },
      },
    ],
  },
  clap: {
    length: 0.5,
    layers: [
      {
        source: 'noise',
        filter: [
          { type: 'highpass', cutoff: 800 },
          { type: 'lowpass', cutoff: 2000 },
        ],
        repeat: 3,
        every: 0.0107,
        envelope: { attack: 0.0005, decay: 0.019 },
      },
      {
        source: 'noise',
        delay: 0.032,
        filter: [
          { type: 'highpass', cutoff: 800 },
          { type: 'lowpass', cutoff: 2000 },
        ],
        envelope: { attack: 0.0005, decay: 0.21 },
      },
      {
        source: 'noise',
        gain: 0.3,
        delay: 0.032,
        filter: [
          { type: 'highpass', cutoff: 3200 },
          { type: 'lowpass', cutoff: 10000 },
        ],
        envelope: { attack: 0.0005, decay: 0.21 },
      },
    ],
    fx: { room: 0.2 },
  },
  snap: {
    length: 0.2,
    layers: [
      {
        source: 'noise',
        filter: [
          { type: 'highpass', cutoff: 2000 },
          { type: 'lowpass', cutoff: 5500 },
        ],
        envelope: { attack: 0.0005, decay: 0.03 },
      },
      { source: 'strike', pitch: 420, ring: 0.058, gain: 0.1, partials: [{ ratio: 1, gain: 1 }] },
    ],
    fx: { room: 0.12 },
  },
  success: {
    length: 1,
    layers: [
      { source: 'strike', pitch: 659.3, ring: 0.77, partials: MALLET },
      { source: 'strike', pitch: 784, ring: 0.77, delay: 0.09, partials: MALLET },
      {
        source: 'strike',
        pitch: 1046.5,
        ring: 1.53,
        delay: 0.18,
        partials: MALLET,
        envelope: { attack: 0, hold: 0.62, decay: 0.2, curve: 'linear' },
      },
    ],
  },
  error: {
    length: 0.45,
    layers: [held(165, 0, 0.15), held(167, 0, 0.15, 0.6), held(147, 0.21, 0.19), held(148.8, 0.21, 0.19, 0.6)].map(
      (layer) => ({
        ...layer,
        filter: [
          { type: 'highpass' as const, cutoff: 90 },
          { type: 'lowpass' as const, cutoff: 1100 },
        ],
      })
    ),
  },
  'water-drop': {
    length: 0.3,
    layers: [
      {
        source: 'tone',
        pitch: { from: 450, to: 1500, time: 0.02 },
        filter: { type: 'highpass', cutoff: 200 },
        length: 0.3,
        envelope: { attack: 0.0007, decay: 0.18, release: 0.06 },
      },
    ],
  },
  'whistle-up': {
    length: 0.7,
    layers: [
      {
        source: 'tone',
        pitch: { from: 500, to: 1900 },
        vibrato: { rate: 6, depth: 0.4 },
        filter: { type: 'lowpass', cutoff: 7000 },
        length: 0.7,
        envelope: { attack: 0.03, sustain: 1, release: 0.06, curve: 'linear' },
      },
      {
        source: 'noise',
        color: 'pink',
        gain: 0.12,
        filter: { type: 'bandpass', cutoff: 1800 },
        length: 0.7,
        envelope: { attack: 0.05, sustain: 1, release: 0.1, curve: 'linear' },
      },
    ],
  },
  'camera-focus': {
    length: 0.62,
    layers: [
      {
        source: 'tone',
        pitch: 480,
        vibrato: { rate: 9, depth: 0.2 },
        gain: 0.45,
        drive: 0.11,
        filter: { type: 'highpass', cutoff: 150 },
        length: 0.3,
        envelope: { attack: 0.03, sustain: 1, release: 0.03, curve: 'linear' },
      },
      {
        source: 'tone',
        pitch: 2900,
        gain: 0.5,
        delay: 0.38,
        repeat: 2,
        every: 0.1,
        length: 0.05,
        envelope: { attack: 0.003, sustain: 1, release: 0.003, curve: 'linear' },
      },
    ],
  },
  paper: {
    length: 0.45,
    layers: [
      {
        source: 'noise',
        filter: [
          { type: 'highpass', cutoff: 1200 },
          { type: 'lowpass', cutoff: 7000 },
        ],
        gain: 0.6,
        length: 0.36,
        envelope: { attack: 0.18, decay: 0.18, curve: 'linear' },
      },
      {
        source: 'noise',
        filter: [
          { type: 'highpass', cutoff: 2000 },
          { type: 'lowpass', cutoff: 6000 },
        ],
        gain: 0.3,
        repeat: 32,
        every: 0.011,
        jitter: 0.9,
        envelope: { attack: 0.0003, decay: 0.004 },
      },
      {
        source: 'noise',
        color: 'brown',
        gain: 0.5,
        delay: 0.3,
        filter: { type: 'lowpass', cutoff: 500 },
        envelope: { attack: 0.0005, decay: 0.125 },
      },
    ],
  },
  tada: {
    length: 1.3,
    layers: [
      held(392, 0, 0.11, 0.8),
      ...[523.25, 659.25, 784].map((pitch) => ({
        ...held(pitch, 0.15, 1.13),
        vibrato: { rate: 5.5, depth: 0.15 },
        envelope: { attack: 0.015, decay: 4, release: 0.2 },
      })),
    ].map((layer) => ({
      ...layer,
      filter: [
        { type: 'highpass' as const, cutoff: 120 },
        { type: 'lowpass' as const, cutoff: 3800 },
      ],
    })),
    fx: { echo: 0.2, room: 0.1 },
  },
} satisfies Record<string, ComposedSound>;
