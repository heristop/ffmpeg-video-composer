// Single source of truth for the curated media library, shared by web + expo.
// Assets live under ./library/musics and ./library/backgrounds and are copied
// into each app's static dir by scripts/copy-core-assets.ts at build/dev time.
import { MUSIC_LIBRARY } from './music-library';
import { BACKGROUND_LIBRARY } from './background-library';

export interface MediaCredit {
  id: string;
  title: string;
  author: string;
  license: string;
  sourceUrl: string;
  file: string; // filename only, e.g. 'point-being.mp3'
}

export { MUSIC_LIBRARY, BACKGROUND_LIBRARY };

export function findMusic(id: string): MediaCredit | undefined {
  return MUSIC_LIBRARY.find((m) => m.id === id);
}
export function findBackground(id: string): MediaCredit | undefined {
  return BACKGROUND_LIBRARY.find((m) => m.id === id);
}
