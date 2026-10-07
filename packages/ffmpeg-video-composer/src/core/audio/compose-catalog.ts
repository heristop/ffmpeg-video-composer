// The `compose` part of the audio catalog (motionCatalog().audio.compose): how to build a sound from the
// synth vocabulary, by role, with worked examples and the library recipes to start from, so an agent shapes
// the sound a moment needs instead of reaching for the same whoosh as everyone. Pure data.

import type { SfxId } from './sfx-library';
import type { ComposedSound } from './synth/types';

export interface ComposeRecipe {
  how: string;
  presets: SfxId[];
  example: ComposedSound;
}

export interface ComposeCatalog {
  vocabulary: string;
  presets: string;
  recipes: Record<'impact' | 'riser' | 'blip' | 'texture', ComposeRecipe>;
  rules: string[];
  analyze: string;
}

const RECIPES: ComposeCatalog['recipes'] = {
  impact: {
    how:
      'A low tone gliding down fast (pitch {from: 150-200, to: 40-60, time: 0.05-0.1}) for the body, plus a ' +
      'short lowpassed noise burst (decay 0.03-0.08) for the snap; drive 0.1-0.3 so small speakers hear it.',
    presets: ['hit', 'boom', 'thud', 'sub-drop'],
    example: {
      length: 0.5,
      layers: [
        { source: 'tone', pitch: { from: 180, to: 50, time: 0.08 }, drive: 0.2, envelope: { decay: 0.45 } },
        { source: 'noise', gain: 0.5, filter: { type: 'lowpass', cutoff: 2500 }, envelope: { decay: 0.06 } },
      ],
    },
  },
  riser: {
    how:
      'A tone sweeping up over the whole sound and a highpassed noise, both with a long exp attack (it swells ' +
      'at the end); anchor "end" so it lands on the cue.',
    presets: ['riser', 'rise-short', 'reverse-cymbal'],
    example: {
      length: 1.5,
      layers: [
        {
          source: 'tone',
          pitch: { from: 250, to: 2500 },
          gain: 0.6,
          envelope: { attack: 1.45, sustain: 1, release: 0.05 },
        },
        {
          source: 'noise',
          gain: 0.2,
          filter: { type: 'highpass', from: 1500, to: 6000 },
          envelope: { attack: 1.45, sustain: 1, release: 0.05 },
        },
      ],
    },
  },
  blip: {
    how:
      'A short pitched note (tone 600-2500 Hz, decay 0.05-0.2, or a strike with partials for a bell); two ' +
      'notes a fourth or fifth apart read as success, a falling pair as error.',
    presets: ['blip', 'pop', 'tick', 'ding', 'notification', 'success', 'coin', 'error'],
    example: {
      layers: [
        {
          source: 'strike',
          pitch: 880,
          ring: 0.3,
          partials: [
            { ratio: 1, gain: 1 },
            { ratio: 2.76, gain: 0.3 },
          ],
        },
        { source: 'strike', pitch: 1320, ring: 0.4, delay: 0.08 },
      ],
    },
  },
  texture: {
    how:
      'Filtered noise with a slow envelope: pink for air, brown for rumble, a swept filter for motion; repeat ' +
      'with jitter for crackle, rolls and ticks (accelerate for a build).',
    presets: ['whoosh', 'swoosh-long', 'paper', 'drum-roll', 'clap'],
    example: {
      length: 0.7,
      layers: [
        {
          source: 'noise',
          color: 'pink',
          filter: { type: 'bandpass', from: 600, to: 4000 },
          envelope: { attack: 0.35, decay: 0.35, curve: 'linear' },
        },
      ],
    },
  },
};

export function composeCatalog(): ComposeCatalog {
  return {
    vocabulary:
      'sfx[].sound: { layers: [{ source: tone|noise|strike|silence, pitch, envelope, filter, drive, gain, ' +
      'pan, delay, repeat/every/accelerate/jitter }], length?, anchor?, fx: { saturate, crush, room, echo } }; ' +
      'max 4 s, 8 layers; peak-normalised to -3 dBFS like the library, then `volume` applies (default 0.6).',
    presets:
      'Every library sound is also a recipe: sound: { preset: "<id>", pitch (ratio), length (s), brightness ' +
      '(-1..1), room } varies it (get_template_schema shows the vocabulary).',
    recipes: RECIPES,
    rules: [
      'One signature sound per beat; vary pitch rather than repeat (pitch 0.9 / 1 / 1.12 on the same preset).',
      'Start from the closest preset and vary it before composing from scratch.',
      'Gains set the balance between layers, not the level: the render is normalised, `volume` sets the mix.',
      'Keep sounds shorter than the moment they mark; long low tails fight the music bed.',
    ],
    analyze:
      'MCP analyze_sound renders a sound and returns length, peak, RMS level, spectral centroid, attack and a ' +
      'spectrogram: iterate until the numbers match the intent (a warm pop: centroid under 2 kHz, attack under 10 ms).',
  };
}
