// The builder's animation library: engine primitives first, stock APNG samples last.
//
// Every engine entry is a procedural primitive the engine lowers at output resolution (a `graphics[]`
// entry: an `fx` light or a stroke graphic). Choosing one inserts that graphic with the section's
// default target and context-derived parameters (fx-draft.ts), then the builder opens its parameter
// panel, so the result is tuned to the template instead of a stock look. The legacy APNG overlays stay
// listed as "Samples": existing descriptors that reference them keep rendering unchanged, and each one
// maps to the primitive that replaces it (`legacyEquivalent`). Pure data and lookups, UI-free.

import type { Graphic } from 'ffmpeg-video-composer/src/schemas/graphics.schemas.ts';
import type { FxEffectName } from 'ffmpeg-video-composer/src/schemas/fx-primitives.schemas.ts';

/** Picker sections, in display order. */
export const ANIMATION_GROUPS = ['light', 'focus', 'celebrate', 'frames', 'ambient', 'samples'] as const;
export type AnimationGroup = (typeof ANIMATION_GROUPS)[number];

/** The stroke graphics the library offers. */
export type LibraryStrokeType = 'frame' | 'corners' | 'underline';

/** The fields that name an entry: its type, its effect and the variant fields that set it apart. */
export type LibraryPreset =
  | { type: 'fx'; effect: FxEffectName; variant?: 'ring' | 'tap'; path?: 'scatter' | 'corners' | 'orbit' }
  | { type: LibraryStrokeType };

/** Where a fresh placement lands: on the section's subject (its main layer) or on the whole frame. */
export type LibraryAnchor = 'subject' | 'frame';

export interface EngineLibraryEntry {
  id: string;
  kind: 'fx' | 'graphic';
  group: Exclude<AnimationGroup, 'samples'>;
  preset: LibraryPreset;
  anchor: LibraryAnchor;
}

export interface SampleLibraryEntry {
  id: string;
  kind: 'sample';
  group: 'samples';
  /** File name under animations/ (e.g. "shine_sweep.apng"). */
  file: string;
  /** The engine entry that composes the same idea (see legacyEquivalent). */
  equivalent?: string;
}

export type AnimationLibraryEntry = EngineLibraryEntry | SampleLibraryEntry;

function fx(
  id: string,
  group: EngineLibraryEntry['group'],
  anchor: LibraryAnchor,
  preset: Omit<Extract<LibraryPreset, { type: 'fx' }>, 'type'>
): EngineLibraryEntry {
  return { id, kind: 'fx', group, anchor, preset: { type: 'fx', ...preset } };
}

function stroke(type: LibraryStrokeType): EngineLibraryEntry {
  return { id: type, kind: 'graphic', group: 'frames', anchor: 'subject', preset: { type } };
}

/** The engine primitives, grouped as the picker shows them. */
export const ENGINE_LIBRARY: readonly EngineLibraryEntry[] = [
  fx('sheen', 'light', 'subject', { effect: 'sheen' }),
  fx('glint-orbit', 'light', 'subject', { effect: 'glint', path: 'orbit' }),
  fx('edge-glow', 'light', 'subject', { effect: 'edge-glow' }),
  fx('leak', 'light', 'frame', { effect: 'leak' }),
  fx('bloom', 'light', 'frame', { effect: 'bloom' }),
  fx('ripple', 'focus', 'subject', { effect: 'ripple', variant: 'ring' }),
  fx('ripple-tap', 'focus', 'subject', { effect: 'ripple', variant: 'tap' }),
  fx('resolve', 'focus', 'subject', { effect: 'resolve' }),
  fx('glass', 'focus', 'subject', { effect: 'glass' }),
  fx('vignette-breathe', 'focus', 'frame', { effect: 'vignette-breathe' }),
  fx('confetti', 'celebrate', 'subject', { effect: 'confetti' }),
  fx('glint', 'celebrate', 'subject', { effect: 'glint' }),
  stroke('frame'),
  stroke('corners'),
  stroke('underline'),
  fx('bokeh', 'ambient', 'frame', { effect: 'bokeh' }),
  fx('dust', 'ambient', 'frame', { effect: 'dust' }),
  fx('grain', 'ambient', 'frame', { effect: 'grain' }),
];

/** Each legacy APNG (file stem) → the engine entry that replaces it. */
const LEGACY_EQUIVALENTS: Record<string, string> = {
  shine_sweep: 'sheen',
  spec_orbit: 'glint-orbit',
  sparkle: 'glint',
  light_leak: 'leak',
  confetti: 'confetti',
  corner_brackets: 'corners',
  glow_border: 'edge-glow',
  white_border: 'frame',
  rounded_border: 'frame',
  pulse_ring: 'ripple',
  tap_pulse: 'ripple-tap',
};

/**
 * Samples the picker no longer lists: animation_icons (unused, unknown content) and spec_orbit (merged into
 * the glint primitive's orbit path). Their files stay in the library, so descriptors using them still render.
 */
export const HIDDEN_SAMPLES: readonly string[] = ['animation_icons', 'spec_orbit'];

const SAMPLE_URL = /(?:^|\/)animations\/([\w-]+)\.(?:apng|webp|gif|webm)$/i;

function stemOf(file: string): string {
  return file.replace(/\.[^.]+$/, '');
}

/** The i18n key of an entry's human label (`animation.library.<id>`), shared by web and Expo. */
export function libraryLabelKey(id: string): string {
  return `animation.library.${id}`;
}

export function findEngineEntry(id: string): EngineLibraryEntry | undefined {
  return ENGINE_LIBRARY.find((entry) => entry.id === id);
}

/** The sample cards for these library files (hidden samples dropped), in file order. */
export function sampleEntries(files: readonly string[]): SampleLibraryEntry[] {
  return files
    .filter((file) => !HIDDEN_SAMPLES.includes(stemOf(file)))
    .map((file) => ({
      id: stemOf(file).replace(/_/g, '-'),
      kind: 'sample',
      group: 'samples',
      file,
      equivalent: LEGACY_EQUIVALENTS[stemOf(file)],
    }));
}

/** The engine entry a legacy animation url maps to (`/assets/animations/shine_sweep.apng` → sheen), if any. */
export function legacyEquivalent(url: string): EngineLibraryEntry | undefined {
  const stem = SAMPLE_URL.exec(url.trim())?.[1];
  const id = stem === undefined ? undefined : LEGACY_EQUIVALENTS[stem];

  return id === undefined ? undefined : findEngineEntry(id);
}

function presetMatches(preset: LibraryPreset, graphic: Graphic): boolean {
  if (preset.type !== graphic.type) return false;

  if (preset.type !== 'fx' || graphic.type !== 'fx') return true;

  const fields = graphic as { effect: string; variant?: string; path?: string };

  if (preset.effect !== fields.effect) return false;

  // Only the orbit path is its own card; scatter and corners are the glint card's own settings.
  return (
    (preset.variant ?? 'ring') === (fields.variant ?? 'ring') && (preset.path === 'orbit') === (fields.path === 'orbit')
  );
}

/**
 * The library entry a graphic reads as (an orbit glint → "glint-orbit", a tap ripple → "ripple-tap"), so a
 * builder row or panel can label it; undefined for graphics the library does not offer (flash, bars…).
 */
export function libraryEntryOfGraphic(graphic: Graphic): EngineLibraryEntry | undefined {
  const exact = ENGINE_LIBRARY.find((entry) => presetMatches(entry.preset, graphic));

  if (exact || graphic.type !== 'fx') return exact;

  // An fx with a variant the library has no card for still reads as its primitive.
  return ENGINE_LIBRARY.find((entry) => entry.preset.type === 'fx' && entry.preset.effect === graphic.effect);
}

/** The entries of one picker group (samples come from `sampleEntries`). */
export function engineEntriesIn(group: AnimationGroup): EngineLibraryEntry[] {
  return ENGINE_LIBRARY.filter((entry) => entry.group === group);
}
