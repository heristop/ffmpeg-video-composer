// The bundled sound-effect library for builders (web + expo): the engine's manifest (core/audio/sfx-library)
// plus where each file lives in this kit and its license. The files are synthesized by scripts/gen-sfx.ts
// (`pnpm --dir packages/leclap-creative-kit gen:sfx`), so they are original audio with no third-party rights.
// Each item also carries its recipe in the engine's sound vocabulary (core/audio/sound-presets), the
// starting point of a `sound: { preset, pitch, length, brightness, room }` cue.
import { SFX_IDS, SFX_LIBRARY, type SfxEntry, type SfxId } from 'ffmpeg-video-composer/src/core/audio/sfx-library.ts';
import { SOUND_PRESETS } from 'ffmpeg-video-composer/src/core/audio/sound-presets/index.ts';
import type { ComposedSound } from 'ffmpeg-video-composer/src/core/audio/synth/types.ts';

export type { SfxEntry, SfxId };

export interface SfxLibraryItem extends SfxEntry {
  /** Path under this package's `src/library/`, e.g. `sfx/whoosh.m4a`. */
  path: string;
  license: string;
  /** The sound as a recipe in the engine's sound vocabulary. */
  recipe: ComposedSound;
}

export const SFX_LICENSE = 'CC0 1.0 (original, procedurally synthesized by scripts/gen-sfx.ts)';

export const SFX_ITEMS: SfxLibraryItem[] = SFX_IDS.map((id) => ({
  ...SFX_LIBRARY[id],
  path: `sfx/${SFX_LIBRARY[id].file}`,
  license: SFX_LICENSE,
  recipe: SOUND_PRESETS[id],
}));
