// The library sounds for motion — transitions, impacts and builds — re-expressed in the sound vocabulary.
// Each mirrors its lavfi recipe in leclap-creative-kit/scripts/gen-sfx.ts: a `exp(-k·t)` decay becomes an
// exponential envelope decay of 5/k seconds, an `f0 + a·exp(-k·t)` pitch a glide over ~4/k seconds,
// `tanh(g·…)` a layer `drive`. Pure data.

import type { ComposedSound } from '../synth/types';

export const MOTION_RECIPES = {
  whoosh: {
    length: 0.6,
    layers: [
      {
        source: 'noise',
        color: 'pink',
        filter: [
          { type: 'highpass', cutoff: 300 },
          { type: 'lowpass', cutoff: 5000 },
        ],
        envelope: { attack: 0.32, decay: 0.28, curve: 'linear' },
      },
    ],
  },
  'swoosh-short': {
    length: 0.3,
    layers: [
      {
        source: 'noise',
        filter: [
          { type: 'highpass', cutoff: 900 },
          { type: 'lowpass', cutoff: 8000 },
        ],
        envelope: { attack: 0.12, decay: 0.18 },
      },
    ],
  },
  hit: {
    length: 0.5,
    layers: [
      {
        source: 'tone',
        pitch: { from: 195, to: 55, time: 0.08 },
        length: 0.5,
        envelope: { attack: 0.001, decay: 0.7, release: 0.15 },
      },
      {
        source: 'noise',
        gain: 0.5,
        filter: { type: 'lowpass', cutoff: 2500 },
        envelope: { attack: 0.001, decay: 0.06, curve: 'linear' },
      },
    ],
  },
  boom: {
    length: 1.2,
    layers: [
      {
        source: 'tone',
        pitch: { from: 128, to: 38, time: 0.25 },
        length: 1.2,
        envelope: { attack: 0.002, decay: 1.55, release: 0.3 },
      },
      {
        source: 'noise',
        color: 'brown',
        gain: 0.7,
        filter: { type: 'lowpass', cutoff: 400 },
        envelope: { attack: 0.001, decay: 0.5 },
      },
    ],
  },
  riser: {
    length: 2,
    layers: [
      {
        source: 'tone',
        gain: 0.5,
        pitch: { from: 288, to: 4070 },
        length: 2,
        envelope: { attack: 1.97, sustain: 1, release: 0.03, curve: 'exp' },
      },
      {
        source: 'noise',
        gain: 0.1,
        filter: { type: 'highpass', cutoff: 2500 },
        length: 2,
        envelope: { attack: 1.9, sustain: 1, release: 0.03 },
      },
    ],
  },
  'rise-short': {
    length: 0.6,
    layers: [
      {
        source: 'tone',
        gain: 0.5,
        pitch: { from: 350, to: 1430, curve: 'linear' },
        length: 0.6,
        envelope: { attack: 0.58, sustain: 1, release: 0.02, curve: 'exp' },
      },
      {
        source: 'noise',
        gain: 0.15,
        filter: { type: 'highpass', cutoff: 3000 },
        length: 0.6,
        envelope: { attack: 0.58, sustain: 1, release: 0.02 },
      },
    ],
  },
  thud: {
    length: 0.45,
    layers: [
      {
        source: 'tone',
        pitch: { from: 118, to: 48, time: 0.08 },
        drive: 0.2,
        filter: { type: 'lowpass', cutoff: 900 },
        length: 0.45,
        envelope: { attack: 0.0013, decay: 0.5, release: 0.12 },
      },
      {
        source: 'noise',
        color: 'brown',
        gain: 0.6,
        filter: { type: 'lowpass', cutoff: 260 },
        envelope: { attack: 0.001, decay: 0.12 },
      },
    ],
  },
  zap: {
    length: 0.35,
    layers: [
      {
        source: 'tone',
        wave: 'saw',
        pitch: { from: 2560, to: 160, time: 0.2 },
        drive: 0.25,
        filter: [
          { type: 'highpass', cutoff: 150 },
          { type: 'lowpass', cutoff: 7000 },
        ],
        length: 0.35,
        envelope: { attack: 0.002, decay: 0.83, release: 0.08 },
      },
    ],
  },
  'swoosh-long': {
    length: 1.2,
    layers: [
      {
        source: 'noise',
        color: 'pink',
        filter: [
          { type: 'highpass', cutoff: 500 },
          { type: 'lowpass', from: 2500, to: 10000, resonance: 2 },
        ],
        envelope: { attack: 0.6, decay: 0.6, curve: 'linear' },
      },
    ],
  },
  'sub-drop': {
    length: 1.5,
    layers: [
      {
        source: 'tone',
        pitch: { from: 160, to: 38, time: 0.7 },
        drive: 0.15,
        filter: { type: 'lowpass', cutoff: 600 },
        length: 1.5,
        envelope: { attack: 0.0033, decay: 3.5, release: 0.3 },
      },
    ],
  },
  'reverse-cymbal': {
    length: 1.5,
    layers: [
      {
        source: 'noise',
        filter: [
          { type: 'highpass', cutoff: 3000 },
          { type: 'lowpass', cutoff: 14000 },
        ],
        length: 1.5,
        envelope: { attack: 1.485, sustain: 1, release: 0.015, curve: 'exp' },
      },
      {
        source: 'noise',
        gain: 0.6,
        filter: { type: 'bandpass', cutoff: 6500, resonance: 2 },
        length: 1.5,
        envelope: { attack: 1.485, sustain: 1, release: 0.015, curve: 'exp' },
      },
    ],
  },
} satisfies Record<string, ComposedSound>;
