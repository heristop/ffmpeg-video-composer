// Pure editing helpers for the sound-effects panel: a section's `sfx` and the whole video's `global.sfx`
// (the editor's `audio.cues`). Every edit spreads the existing cue, so fields the panel has no control for
// (a composed `sound`, anything a later engine adds) survive untouched.
import { SFX_LIBRARY, type SfxId } from 'ffmpeg-video-composer/src/core/audio/sfx-library.ts';
import { DEFAULT_SOUND_VOLUME } from 'ffmpeg-video-composer/src/core/audio/synth/bounds.ts';
import { TimeRefSchema } from 'ffmpeg-video-composer/src/schemas/time.schemas.ts';
import type { SfxCue } from 'ffmpeg-video-composer/src/schemas/audio.schemas.ts';

export type { SfxCue, SfxId };

/** SectionSfxSchema's cap. */
export const SECTION_SFX_MAX = 32;
/** GlobalSfxSchema's cap. */
export const GLOBAL_SFX_MAX = 64;

const VOLUME_MAX = 2;

/** The library id a cue plays by name, or undefined for a composed `sound`. */
export function cueLibraryId(cue: SfxCue): SfxId | undefined {
  return cue.id;
}

/** The level a cue plays at with no `volume`: the library default of its id or preset, else the synth's 0.6. */
export function cueDefaultVolume(cue: SfxCue): number {
  const id = cue.id ?? cue.sound?.preset;

  if (id === undefined) return DEFAULT_SOUND_VOLUME;

  return SFX_LIBRARY[id].defaultVolume;
}

/** A library sound appended at 0 s with no volume; the same list when it is already full. */
export function addCue(cues: SfxCue[] | undefined, id: SfxId, max: number): SfxCue[] {
  const list = cues ?? [];

  if (list.length >= max) return list;

  return [...list, { id, at: 0 }];
}

/** The list without cue `index`, or undefined once it is empty (so no `sfx: []` is written). */
export function removeCue(cues: SfxCue[], index: number): SfxCue[] | undefined {
  const next = cues.filter((_, i) => i !== index);

  return next.length > 0 ? next : undefined;
}

/** Sets cue `index`'s volume (0..2), keeping the rest of the cue. */
export function setCueVolume(cues: SfxCue[], index: number, volume: number): SfxCue[] {
  return cues.map((cue, i) => (i === index ? { ...cue, volume } : cue));
}

/** Drops cue `index`'s volume so it plays at its default level again. */
export function resetCueVolume(cues: SfxCue[], index: number): SfxCue[] {
  return cues.map((cue, i) => {
    if (i !== index) return cue;

    const { volume: _drop, ...rest } = cue;

    return rest;
  });
}

export function setCueTime(cues: SfxCue[], index: number, at: SfxCue['at']): SfxCue[] {
  return cues.map((cue, i) => (i === index ? { ...cue, at } : cue));
}

/** Slider percent (0..200) to the cue's gain (0..2), clamped and rounded to the percent. */
export function percentToVolume(percent: number): number {
  const clamped = Math.min(VOLUME_MAX * 100, Math.max(0, percent));

  return Math.round(clamped) / 100;
}

export function volumeToPercent(volume: number): number {
  return Math.round(volume * 100);
}

export type CueTimeParse = { ok: true; at: SfxCue['at'] } | { ok: false };

const SECONDS = /^\d+(?:[.,]\d+)?$/;

/** The time field's text as seconds, or as a time reference the engine accepts; ok: false otherwise. */
export function parseCueTime(text: string): CueTimeParse {
  const trimmed = text.trim();

  if (trimmed === '') return { ok: false };

  if (SECONDS.test(trimmed)) return { ok: true, at: Number(trimmed.replace(',', '.')) };

  const reference = TimeRefSchema.safeParse(trimmed);

  if (!reference.success) return { ok: false };

  return { ok: true, at: reference.data };
}

export function formatCueTime(at: SfxCue['at']): string {
  return String(at);
}

/** Where the web app serves a library sound (scripts/copy-core-assets.ts stages the creative-kit `sfx/`). */
export function sfxPreviewUrl(id: SfxId): string {
  return `/assets/sfx/${SFX_LIBRARY[id].file}`;
}
