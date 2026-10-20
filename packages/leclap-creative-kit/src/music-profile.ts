// What the music pickers show about each library track, measured offline by
// scripts/analyze-music-profile.ts and stored in music-profile.generated.json (about 6 KB for the
// library): length, a 64-bar waveform, the tempo when the beat analysis trusted it, and the moods the
// publisher labelled the track with.
//
// Regenerate after adding or replacing a track (after gen:music-beats, which it reads the tempo from):
//   pnpm --filter @leclap/creative-kit gen:music-profile

import generated from './music-profile.generated.json';

export type MusicMood = 'calm' | 'upbeat' | 'jazzy' | 'playful';

export interface MusicProfile {
  durationSec: number;
  /** Beats per minute, present only when the beat analysis marked the pulse usable. */
  bpm?: number;
  moods?: MusicMood[];
  /** 64 bars of RMS level, one base-36 digit each (0 = silence, z = the track's loudest bar). */
  peaks: string;
}

export const MUSIC_MOODS: readonly MusicMood[] = ['calm', 'upbeat', 'jazzy', 'playful'];

const PROFILES = (generated as { tracks: Record<string, MusicProfile> }).tracks;

export function findMusicProfile(id: string): MusicProfile | undefined {
  return Object.hasOwn(PROFILES, id) ? PROFILES[id] : undefined;
}

/** The waveform bars as 0..1 levels. */
export function profileBars(peaks: string): number[] {
  return Array.from(peaks, (digit) => Number.parseInt(digit, 36) / 35);
}
