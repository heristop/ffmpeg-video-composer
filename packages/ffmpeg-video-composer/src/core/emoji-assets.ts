// Which bundled colour image draws an emoji cluster, and how text lowering treats emoji at all
// (`global.emoji`). The images themselves live in @leclap/creative-kit/src/library/emoji/ and are
// staged per platform like the bundled fonts; only their names ship with the engine.
import { clusterKey, isSkinTone, VS16 } from './emoji-clusters';
import { EMOJI_ASSET_KEYS, EMOJI_ASSET_SIZE } from './emoji-manifest.generated';

export { EMOJI_ASSET_SIZE };

/** `global.emoji`: composite colour images (default), strip emoji silently, or fail validation. */
export const EMOJI_MODES = ['image', 'strip', 'error'] as const;
export type EmojiMode = (typeof EMOJI_MODES)[number];

/** Emoji images composited per section at most; the rest are stripped with a warning. */
export const MAX_EMOJI_OVERLAYS = 24;

/** Drawn emoji size, as a multiple of the text's font size. */
export const EMOJI_SCALE = 1.1;

/** The build/assets sub-directory (and library folder) the emoji images are staged under. */
export const EMOJI_DIR = 'emoji';

const KEYS = new Set(EMOJI_ASSET_KEYS);

// The manifest keeps U+FE0F inside ZWJ sequences (the image names do), but authors often omit it:
// index every key by its selector-free spelling too, so `🏳‍🌈` finds `1f3f3-fe0f-200d-1f308`.
const BY_LOOSE_KEY = new Map(EMOJI_ASSET_KEYS.map((key) => [withoutSelector(key), key]));

function withoutSelector(key: string): string {
  return key
    .split('-')
    .filter((hex) => Number.parseInt(hex, 16) !== VS16)
    .join('-');
}

function withoutSkinTone(key: string): string {
  return key
    .split('-')
    .filter((hex) => !isSkinTone(Number.parseInt(hex, 16)))
    .join('-');
}

/**
 * The bundled image key for an emoji cluster, or null when none fits. Lookups fall back from the exact
 * sequence, to the sequence without U+FE0F, to the sequence without skin tones, to the base emoji — so a
 * skin-toned or newly combined emoji still draws its closest bundled relative.
 */
export function emojiAssetKey(cluster: string): string | null {
  const exact = clusterKey(cluster);

  if (KEYS.has(exact)) return exact;

  const loose = withoutSelector(exact);
  const toneless = withoutSkinTone(loose);
  const base = loose.split('-')[0];

  for (const candidate of [loose, toneless, base]) {
    const key = BY_LOOSE_KEY.get(candidate);

    if (key !== undefined) return key;
  }

  return null;
}

/** The image file (bare name) for a bundled key. */
export function emojiAssetFile(key: string): string {
  return `${key}.png`;
}

/** Every bundled image file, for hosts that stage the whole set (the Expo app). */
export function emojiAssetFiles(): string[] {
  return EMOJI_ASSET_KEYS.map(emojiAssetFile);
}

/** The template's emoji mode; anything but a known mode reads as the default, `image`. */
export function emojiMode(global: { emoji?: unknown } | undefined): EmojiMode {
  const mode = global?.emoji;

  return mode === 'strip' || mode === 'error' ? mode : 'image';
}
