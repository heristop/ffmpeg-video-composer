// The bundled sound-effect library for builders (web + expo): the engine's manifest (core/audio/sfx-library)
// plus where each file lives in this kit and its license. The files are synthesized by scripts/gen-sfx.ts
// (`pnpm --dir packages/leclap-creative-kit gen:sfx`), so they are original audio with no third-party rights.
import { SFX_IDS, SFX_LIBRARY, type SfxEntry, type SfxId } from 'ffmpeg-video-composer/src/core/audio/sfx-library.ts';

export type { SfxEntry, SfxId };

export interface SfxLibraryItem extends SfxEntry {
  /** Path under this package's `src/library/`, e.g. `sfx/whoosh.m4a`. */
  path: string;
  license: string;
}

export const SFX_LICENSE = 'CC0 1.0 (original, procedurally synthesized by scripts/gen-sfx.ts)';

export const SFX_ITEMS: SfxLibraryItem[] = SFX_IDS.map((id) => ({
  ...SFX_LIBRARY[id],
  path: `sfx/${SFX_LIBRARY[id].file}`,
  license: SFX_LICENSE,
}));
