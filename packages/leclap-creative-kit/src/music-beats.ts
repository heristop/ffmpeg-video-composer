// Beat grids and cues of the curated music library (MUSIC_LIBRARY in ./media.ts), measured offline by
// scripts/analyze-music-library.ts with the engine's analyzer and stored in music-beats.generated.json.
// The builder fills `global.beats` and the drop cue from here when a library track is picked, so the web
// and on-device engines (which cannot analyze music at compile time) still cut on the beat.
//
// Regenerate after adding or replacing a track (the audio must be checked out, not a Git LFS pointer):
//   git lfs pull --include "packages/leclap-creative-kit/src/library/musics/*"
//   pnpm --filter ffmpeg-video-composer build
//   pnpm --filter @leclap/creative-kit gen:music-beats
// A track missing from the table (not decodable when it was generated) is analyzed in the browser.

import generated from './music-beats.generated.json';

export interface MusicBeats {
  bpm: number;
  /** Time of beat 1 (the first downbeat), in seconds. */
  offset: number;
  beatsPerBar: number;
  /** Tracked beat times, rounded to the millisecond. */
  times: number[];
  /** Z-score of the tempo peak; 3 or more is a clear pulse. */
  confidence: number;
  /** False for calm / ambient tracks: pace them by phrases, not beats. */
  usable: boolean;
  cues: { build?: number; drop?: number; end: number };
}

export const MUSIC_BEATS: Readonly<Record<string, MusicBeats>> = (generated as { tracks: Record<string, MusicBeats> })
  .tracks;

/** The analysis of a library track by id, when the generated table has it. */
export function findMusicBeats(id: string): MusicBeats | undefined {
  return Object.hasOwn(MUSIC_BEATS, id) ? MUSIC_BEATS[id] : undefined;
}
