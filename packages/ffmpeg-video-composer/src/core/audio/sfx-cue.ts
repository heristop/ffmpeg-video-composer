// What one `sfx` cue plays: a library id or an unvaried `sound.preset` (the shipped file, byte for byte), a
// varied preset (its recipe, sound-presets/vary.ts, rendered by the synth) or a composed `sound`. A rendered
// sound is named by the hash of its content and, when it draws random numbers, its seed, so identical
// sounds share one file. A preset keeps its library anchor and default level. Pure.

import type { SfxCue } from '../../schemas/audio.schemas';
import type { SoundInput } from '../../schemas/sound.schemas';
import { canonicalJson, deriveSeed } from '../determinism/hash';
import { sha256Hex } from '../determinism/sha256';
import { sfxEntry, type SfxEntry, type SfxId } from './sfx-library';
import { isVaried, varyPreset } from './sound-presets';
import { DEFAULT_SOUND_VOLUME, SYNTH_VERSION } from './synth/bounds';
import { soundUsesSeed } from './synth/render';
import { soundLength } from './synth/timing';
import type { ComposedSound, Layer } from './synth/types';

export interface ComposedPlacement {
  spec: ComposedSound;
  /** The seed the render uses (0 when the sound draws no random numbers). */
  seed: number;
}

export interface ResolvedCue extends Pick<SfxEntry, 'duration' | 'anchor' | 'defaultVolume'> {
  id: string;
  /** A library file name, or `<hash>.wav` for a composed sound. */
  file: string;
  sound?: ComposedPlacement;
}

/** The synth's view of a composed sound (the schema's `anchor` only matters to the mix). */
export function composedSpec(sound: SoundInput): ComposedSound {
  const { length, fx } = sound;
  // The schema keeps one flat layer object (small in the prompt); its refinement enforces the per-source
  // fields the synth's union types spell out.
  const layers = (sound.layers ?? []) as Layer[];

  return { layers, ...(length === undefined ? {} : { length }), ...(fx ? { fx } : {}) };
}

/**
 * The seed of the cue at `path` ("sections.<name>.sfx[k]" or "global.sfx[k]") under `globalSeed`
 * (global.seed): what the mix renders it with when the sound draws random numbers.
 */
export function cueSeed(globalSeed: number, path: string): number {
  return deriveSeed(globalSeed, path) >>> 0;
}

/** The build file of a composed sound rendered with `seed`. */
export function soundFileName(spec: ComposedSound, seed: number): string {
  return `${sha256Hex(canonicalJson({ v: SYNTH_VERSION, spec, seed })).slice(0, 16)}.wav`;
}

function library(entry: SfxEntry | undefined): ResolvedCue | undefined {
  if (!entry) return undefined;

  const { id, file, duration, anchor, defaultVolume } = entry;

  return { id, file, duration, anchor, defaultVolume };
}

function rendered(spec: ComposedSound, cueSeed: number, defaults: Pick<ResolvedCue, 'anchor' | 'defaultVolume'>) {
  const seed = soundUsesSeed(spec) ? cueSeed >>> 0 : 0;
  const file = soundFileName(spec, seed);

  return {
    id: `sound-${file.slice(0, 8)}`,
    file,
    duration: soundLength(spec),
    ...defaults,
    sound: { spec, seed },
  };
}

/** What `sound` renders: a preset's recipe with its variations, or the composed layers. */
export function soundSpec(sound: SoundInput): ComposedSound {
  return sound.preset === undefined ? composedSpec(sound) : varyPreset(sound.preset, sound);
}

function preset(sound: SoundInput & { preset: SfxId }, cueSeed: number): ResolvedCue | undefined {
  const entry = library(sfxEntry(sound.preset));

  if (!entry) return undefined;

  const defaults = { anchor: sound.anchor ?? entry.anchor, defaultVolume: entry.defaultVolume };

  if (!isVaried(sound)) return { ...entry, ...defaults };

  return rendered(varyPreset(sound.preset, sound), cueSeed, defaults);
}

/** The sound a cue plays, with `cueSeed` = deriveSeed(global.seed, the cue's path); undefined if unknown. */
export function resolveCue(cue: SfxCue, cueSeed: number): ResolvedCue | undefined {
  if (cue.id !== undefined) return library(sfxEntry(cue.id));

  if (!cue.sound) return undefined;

  const { sound } = cue;

  if (sound.preset !== undefined) return preset({ ...sound, preset: sound.preset }, cueSeed);

  return rendered(composedSpec(sound), cueSeed, {
    anchor: sound.anchor ?? 'start',
    defaultVolume: DEFAULT_SOUND_VOLUME,
  });
}
