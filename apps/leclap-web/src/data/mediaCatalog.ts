import {
  MUSIC_LIBRARY as CORE_MUSIC,
  BACKGROUND_LIBRARY as CORE_BG,
  type MediaCredit as CoreMediaCredit,
} from '@leclap/creative-kit/media';
import {
  ANIMATION_GROUPS,
  ENGINE_LIBRARY,
  libraryLabelKey,
  sampleEntries,
  type AnimationGroup,
  type EngineLibraryEntry,
} from '@leclap/creative-kit/editor';
import { ANIMATION_FILES, ANIMATION_THUMBS } from './animations.generated';

export type MediaCredit = CoreMediaCredit & {
  url: string; // same-origin path under /public, derived from `file`
  cover?: string; // cover-art image URL (/assets/covers/<id>.webp); the music card falls back to a generated cover
};

export type AnimationAsset = { id: string; label: string; file: string; url: string };

export const MUSIC_LIBRARY: MediaCredit[] = CORE_MUSIC.map((m) => ({
  ...m,
  url: `/musics/${m.file}`,
  cover: `/assets/covers/${m.id}.webp`,
})).sort((a, b) => a.title.localeCompare(b.title));
export const BACKGROUND_LIBRARY: MediaCredit[] = CORE_BG.map((m) => ({ ...m, url: `/backgrounds/${m.file}` }));

// The list comes from a manifest scripts/copy-core-assets generates from the creative-kit animations
// library (regenerated on web build/start). A static import is HMR-friendly and avoids a cross-package
// import.meta.glob the dev server doesn't re-scan. URLs are the stable /public/assets/animations copy,
// so a saved template descriptor keeps a portable path.
const labelFromFile = (file: string): string => {
  const base = file
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim();

  return base.charAt(0).toUpperCase() + base.slice(1);
};

export const ANIMATION_LIBRARY: AnimationAsset[] = ANIMATION_FILES.map((file) => ({
  id: file.replace(/\.[^.]+$/, '').replace(/_/g, '-'),
  label: labelFromFile(file),
  file,
  url: `/assets/animations/${file}`,
}));

// The animation picker: engine primitives first (grouped Light, Focus, Celebrate, Frames, Ambient), the
// legacy APNG overlays last as Samples (animation_icons hidden, spec_orbit merged into the orbit glint).
// Each card carries its engine-rendered thumbnail (gen:animation-thumbs) and an i18n label key.
export interface PickerCard {
  /** Unique across the picker: `<kind>:<id>`. */
  key: string;
  id: string;
  group: AnimationGroup;
  labelKey: string;
  /** English label from the thumbnail manifest, used until the translation loads. */
  fallbackLabel: string;
  /** Looping preview and still poster (absent when the thumbnails were not generated). */
  thumb?: string;
  poster?: string;
  /** Set on engine cards: the primitive a pick inserts. */
  engine?: EngineLibraryEntry;
  /** Set on sample cards: the legacy overlay a pick uses. */
  sample?: AnimationAsset;
}

export interface PickerGroup {
  group: AnimationGroup;
  cards: PickerCard[];
}

const thumbOf = (kind: 'engine' | 'sample', id: string) =>
  ANIMATION_THUMBS.find((thumb) => (kind === 'sample') === (thumb.kind === 'sample') && thumb.id === id);

const engineCard = (entry: EngineLibraryEntry): PickerCard => {
  const thumb = thumbOf('engine', entry.id);

  return {
    key: `${entry.kind}:${entry.id}`,
    id: entry.id,
    group: entry.group,
    labelKey: libraryLabelKey(entry.id),
    fallbackLabel: thumb?.label ?? labelFromFile(entry.id),
    thumb: thumb?.thumb,
    poster: thumb?.poster,
    engine: entry,
  };
};

const SAMPLE_CARDS: PickerCard[] = sampleEntries(ANIMATION_FILES).flatMap((sample) => {
  const asset = ANIMATION_LIBRARY.find((animation) => animation.file === sample.file);
  const thumb = thumbOf('sample', sample.id);

  if (!asset) return [];

  return [
    {
      key: `sample:${sample.id}`,
      id: sample.id,
      group: 'samples',
      labelKey: libraryLabelKey(sample.id),
      fallbackLabel: thumb?.label ?? asset.label,
      thumb: thumb?.thumb,
      poster: thumb?.poster,
      sample: asset,
    },
  ];
});

export const ANIMATION_PICKER: PickerGroup[] = ANIMATION_GROUPS.map((group) => ({
  group,
  cards: group === 'samples' ? SAMPLE_CARDS : ENGINE_LIBRARY.filter((e) => e.group === group).map(engineCard),
}));

/** The picker card of a legacy sample url, if the picker lists it. */
export const findSampleCard = (url: string): PickerCard | undefined =>
  SAMPLE_CARDS.find((card) => card.sample?.url === url);

/** The engine card of a library entry id. */
export const findEngineCard = (id: string): PickerCard | undefined =>
  ANIMATION_PICKER.flatMap((group) => group.cards).find((card) => card.engine?.id === id);

export const findMusic = (id: string): MediaCredit | undefined => MUSIC_LIBRARY.find((m) => m.id === id);
export const findBackground = (id: string): MediaCredit | undefined => BACKGROUND_LIBRARY.find((m) => m.id === id);
export const findAnimationByUrl = (url: string): AnimationAsset | undefined =>
  ANIMATION_LIBRARY.find((a) => a.url === url);
export const findMusicByUrl = (url: string): MediaCredit | undefined => MUSIC_LIBRARY.find((m) => m.url === url);
export const findBackgroundByUrl = (url: string): MediaCredit | undefined =>
  BACKGROUND_LIBRARY.find((m) => m.url === url);
