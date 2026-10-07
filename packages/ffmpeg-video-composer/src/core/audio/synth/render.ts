// A whole composed sound: the layers mixed into a stereo buffer of the sound's length, scaled to full scale,
// the whole-sound fx (saturate, crush, echo per channel, then the room), a 2 ms fade at the very end so a
// cut tail never clicks, and the peak normalised to the library's -3 dBFS. Deterministic: the only
// randomness comes from `seed` (core/determinism derives it from global.seed and the cue's path). Pure.

import { PEAK_DBFS, SYNTH_RATE } from './bounds';
import { renderLayer, type StereoMix } from './layer';
import { normalizePeak } from './normalize';
import { room } from './room';
import { crush, echo, saturate } from './sound-fx';
import { soundLength } from './timing';
import type { ComposedSound, Layer } from './types';
import { encodeWav } from './wav';

export { soundLength } from './timing';

export interface RenderedSound extends StereoMix {
  /** Seconds. */
  duration: number;
  /** Peak of the raw layer mix, before any normalisation (above 1 = the layers were summed too hot). */
  peak: number;
}

const FADE_SECONDS = 0.002;

function applyFx(mix: StereoMix, sound: ComposedSound): void {
  const fx = sound.fx ?? {};

  for (const channel of [mix.left, mix.right]) {
    saturate(channel, fx.saturate ?? 0);
    crush(channel, fx.crush ?? 0);

    if (fx.echo !== undefined) echo(channel, fx.echo);
  }

  room(mix.left, mix.right, fx.room ?? 0);
}

function fadeOut(mix: StereoMix): void {
  const length = Math.min(mix.left.length, Math.round(FADE_SECONDS * SYNTH_RATE));
  const from = mix.left.length - length;

  for (let i = 0; i < length; i++) {
    const gain = 1 - (i + 1) / length;

    mix.left[from + i] *= gain;
    mix.right[from + i] *= gain;
  }
}

/** Renders `sound` with the random streams seeded by `seed`. */
export function renderSound(sound: ComposedSound, seed: number): RenderedSound {
  const duration = soundLength(sound);
  const samples = Math.round(duration * SYNTH_RATE);
  const mix: StereoMix = { left: new Float64Array(samples), right: new Float64Array(samples) };

  for (const [index, layer] of sound.layers.entries()) renderLayer(layer, index, seed >>> 0, mix);

  const peak = normalizePeak([mix.left, mix.right], 0);

  applyFx(mix, sound);
  fadeOut(mix);
  normalizePeak([mix.left, mix.right], PEAK_DBFS);

  return { ...mix, duration, peak };
}

/** The 16-bit stereo 48 kHz WAV bytes of `sound`. */
export function renderSoundWav(sound: ComposedSound, seed: number): Uint8Array {
  const rendered = renderSound(sound, seed);

  return encodeWav(rendered.left, rendered.right);
}

function layerUsesSeed(layer: Layer): boolean {
  if (layer.source === 'silence') return false;

  if ((layer.jitter ?? 0) > 0 && (layer.repeat ?? 1) > 1) return true;

  return layer.source === 'noise' || (layer.source === 'strike' && (layer.click ?? 0) > 0);
}

/** Whether the render draws random numbers (otherwise every seed renders the same bytes). */
export function soundUsesSeed(sound: ComposedSound): boolean {
  return sound.layers.some(layerUsesSeed);
}
