#!/usr/bin/env node
// Generate src/music-beats.generated.json: the beat grid, confidence and cues of every MUSIC_LIBRARY track
// (src/music-library.ts), measured with the engine's deterministic analyzer (FFmpeg decode → analyzeBeats).
// Tracks that cannot be decoded — most often a Git LFS pointer that was never pulled — are skipped with a
// note and keep no entry, so the builder analyzes them in the browser instead.
//
//   git lfs pull --include "packages/leclap-creative-kit/src/library/musics/*"
//   pnpm --filter ffmpeg-video-composer build
//   pnpm --filter @leclap/creative-kit gen:music-beats
import { openSync, readSync, closeSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeMusicFile } from 'ffmpeg-video-composer';

// Loaded by URL: Node runs the TypeScript source directly (type stripping).
const { MUSIC_LIBRARY } = (await import(new URL('../src/music-library.ts', import.meta.url).href)) as {
  MUSIC_LIBRARY: Array<{ id: string; file: string }>;
};
const SAMPLE_RATE = 22050;
const here = path.dirname(fileURLToPath(import.meta.url));
const musicsDir = path.resolve(here, '../src/library/musics');
const outFile = path.resolve(here, '../src/music-beats.generated.json');

function isLfsPointer(file: string): boolean {
  const fd = openSync(file, 'r');
  const head = Buffer.alloc(40);

  readSync(fd, head, 0, head.length, 0);
  closeSync(fd);

  return head.toString('utf8').startsWith('version https://git-lfs');
}

const tracks: Record<string, unknown> = {};
const skipped: string[] = [];

async function analyzeTrack(track: { id: string; file: string }): Promise<void> {
  const file = path.join(musicsDir, track.file);

  if (!existsSync(file) || isLfsPointer(file)) {
    skipped.push(`${track.id} (${existsSync(file) ? 'Git LFS pointer' : 'missing'})`);

    return;
  }

  try {
    const { bpm, offset, beatsPerBar, times, confidence, usable, cues } = await analyzeMusicFile(file);

    tracks[track.id] = { bpm, offset, beatsPerBar, times, confidence, usable, cues };
    console.log(
      `${track.id}: ${bpm} BPM, beat 1 at ${offset}s, confidence ${confidence}${usable ? '' : ' (not usable)'}`
    );
  } catch (error) {
    skipped.push(`${track.id} (${error instanceof Error ? error.message : String(error)})`);
  }
}

// One track at a time (each decode holds the whole track in memory), in id order.
await [...MUSIC_LIBRARY]
  .sort((a, b) => a.id.localeCompare(b.id))
  .reduce((previous, track) => previous.then(() => analyzeTrack(track)), Promise.resolve());

const sorted = Object.fromEntries(Object.entries(tracks).sort(([a], [b]) => a.localeCompare(b)));

writeFileSync(
  outFile,
  `${JSON.stringify({ generatedBy: 'scripts/analyze-music-library.ts', sampleRate: SAMPLE_RATE, tracks: sorted }, null, 2)}\n`
);
console.log(
  `Wrote ${Object.keys(tracks).length} of ${MUSIC_LIBRARY.length} tracks to ${path.relative(process.cwd(), outFile)}`
);

if (skipped.length > 0) console.log(`Skipped: ${skipped.join(', ')}`);
