// A preset with its variations applied: the recipe rewritten before it renders, so "not the same whoosh as
// everyone" costs four numbers.
//   pitch       ratio (0.25..4): every tone/strike pitch and every filter cutoff, like a tape speed change
//               that keeps the timing;
//   length      seconds: every time in the recipe (lengths, delays, gaps, envelopes, glides, rings)
//               stretched by length / the recipe's length;
//   brightness  -1..1: every cutoff moved by up to two octaves, plus a tilt filter on each layer — a lowpass
//               closing to ~500 Hz at -1, a highpass opening to ~1.3 kHz at +1;
//   room        0..1: the recipe's room reverb set to it.
// Pure.

import type { SfxId } from '../sfx-library';
import { soundLength } from '../synth/timing';
import type { ComposedSound, Envelope, Filter, Layer, Pitch } from '../synth/types';
import { MOTION_RECIPES } from './recipes-motion';
import { PROMO_RECIPES } from './recipes-promo';
import { UI_RECIPES } from './recipes-ui';

export interface PresetVariation {
  pitch?: number;
  length?: number;
  brightness?: number;
  room?: number;
}

export const SOUND_PRESETS: Record<SfxId, ComposedSound> = { ...MOTION_RECIPES, ...UI_RECIPES, ...PROMO_RECIPES };

const TILT_OCTAVES = 2;

export function isVaried(variation: PresetVariation): boolean {
  return (['pitch', 'length', 'brightness', 'room'] as const).some((key) => variation[key] !== undefined);
}

interface Scale {
  /** Frequency factor of pitches. */
  pitch: number;
  /** Frequency factor of cutoffs. */
  cutoff: number;
  /** Time factor. */
  time: number;
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

function times(value: number | undefined, factor: number): number | undefined {
  return value === undefined ? undefined : round(value * factor);
}

function scaledPitch(pitch: Pitch, scale: Scale): Pitch {
  if (typeof pitch === 'number') return round(pitch * scale.pitch);

  return {
    ...pitch,
    from: round(pitch.from * scale.pitch),
    to: round(pitch.to * scale.pitch),
    ...timeOf(pitch, scale),
  };
}

function timeOf(value: { time?: number }, scale: Scale): { time?: number } {
  return value.time === undefined ? {} : { time: round(value.time * scale.time) };
}

function scaledFilter(spec: Filter, scale: Scale): Filter {
  const out: Filter = { ...spec, ...timeOf(spec, scale) };

  for (const key of ['cutoff', 'from', 'to'] as const) {
    if (spec[key] !== undefined) out[key] = round((spec[key] ?? 0) * scale.cutoff);
  }

  return out;
}

function scaledEnvelope(envelope: Envelope, factor: number): Envelope {
  const out: Envelope = { ...envelope };

  for (const key of ['attack', 'hold', 'decay', 'release'] as const) {
    if (envelope[key] !== undefined) out[key] = times(envelope[key], factor);
  }

  return out;
}

function tilt(brightness: number): Filter[] {
  if (brightness < 0) return [{ type: 'lowpass', cutoff: round(16000 * 2 ** (5 * brightness)) }];

  if (brightness > 0) return [{ type: 'highpass', cutoff: round(20 * 2 ** (6 * brightness)) }];

  return [];
}

function definedOnly<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T;
}

function scaledLayer(layer: Layer, scale: Scale, brightness: number): Layer {
  if (layer.source === 'silence') return { ...layer, length: round(layer.length * scale.time), ...timed(layer, scale) };

  const filters = [
    ...(layer.filter ? [layer.filter].flat() : []).map((spec) => scaledFilter(spec, scale)),
    ...tilt(brightness),
  ];
  const shared = definedOnly({
    ...timed(layer, scale),
    length: times(layer.length, scale.time),
    every: times(layer.every, scale.time),
    envelope: layer.envelope && scaledEnvelope(layer.envelope, scale.time),
    filter: filters.length === 0 ? undefined : filters,
  });

  if (layer.source === 'noise') return { ...layer, ...shared };

  const pitched = { ...layer, ...shared, pitch: scaledPitch(layer.pitch, scale) };

  return layer.source === 'strike' ? { ...pitched, ...definedOnly({ ring: times(layer.ring, scale.time) }) } : pitched;
}

function timed(layer: { delay?: number }, scale: Scale): { delay?: number } {
  return layer.delay === undefined ? {} : { delay: round(layer.delay * scale.time) };
}

/** The recipe of `id` with `variation` applied (the recipe itself when unvaried). */
export function varyPreset(id: SfxId, variation: PresetVariation): ComposedSound {
  const recipe = SOUND_PRESETS[id];

  if (!isVaried(variation)) return recipe;

  const brightness = variation.brightness ?? 0;
  const base = soundLength(recipe);
  const scale: Scale = {
    pitch: variation.pitch ?? 1,
    cutoff: (variation.pitch ?? 1) * 2 ** (TILT_OCTAVES * brightness),
    time: (variation.length ?? base) / base,
  };
  const fx = variation.room === undefined ? recipe.fx : { ...recipe.fx, room: variation.room };

  return definedOnly({
    layers: recipe.layers.map((layer) => scaledLayer(layer, scale, brightness)),
    length: round(base * scale.time),
    fx,
  });
}
