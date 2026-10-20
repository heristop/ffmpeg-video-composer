#!/usr/bin/env node
// Generate src/music-profile.generated.json: what the music pickers show about every MUSIC_LIBRARY track,
// measured from the audio, small enough to ship with the editor (about 100 bytes a track):
//   - durationSec: length in whole seconds;
//   - peaks: a 64-bar waveform of RMS level, one base-36 digit per bar (0 = silence, z = the track's
//     loudest bar);
//   - bpm: copied from music-beats.generated.json only when that analysis marked the pulse usable, so a
//     tempo the analyzer was unsure of is left out rather than guessed;
//   - moods: calm / upbeat / jazzy / playful, read from the publisher's own labels (the words in the
//     track's title and source page, e.g. Pixabay's "chill", "dance", "jazz" categories). Kevin MacLeod's
//     incompetech links carry no labels, so his site's feel categories are recorded below. A track whose
//     publisher says nothing gets no mood rather than a guess.
//
// Needs FFmpeg on PATH and the decoded audio (not Git LFS pointers):
//   git lfs pull --include "packages/leclap-creative-kit/src/library/musics/*"
//   pnpm --filter @leclap/creative-kit gen:music-profile
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { MUSIC_LIBRARY } = (await import(new URL('../src/music-library.ts', import.meta.url).href)) as {
  MUSIC_LIBRARY: Array<{ id: string; file: string; title: string; sourceUrl: string }>;
};

type Mood = 'calm' | 'upbeat' | 'jazzy' | 'playful';

// Publisher label words → mood. Matched on whole words of the title and source URL.
const MOOD_WORDS: Record<Mood, string[]> = {
  calm: ['chill', 'relaxing', 'peaceful', 'dreamy', 'zen', 'cozy', 'sentimental'],
  upbeat: ['dance', 'party', 'pop', 'tropical'],
  jazzy: ['jazz', 'jazzy', 'elevator'],
  playful: [],
};

// incompetech.com feel categories for the Kevin MacLeod tracks (their URLs carry no labels).
const PUBLISHER_MOODS: Record<string, Mood[]> = {
  'autumn-day': ['calm'],
  carefree: ['upbeat'],
  'the-builder': ['upbeat'],
  'monkeys-spinning-monkeys': ['playful'],
  'fluffing-a-duck': ['playful'],
};

function moodsOf(track: { id: string; title: string; sourceUrl: string }): Mood[] {
  const words = new Set(`${track.title} ${track.sourceUrl}`.toLowerCase().split(/[^a-z]+/));
  const labelled = (Object.keys(MOOD_WORDS) as Mood[]).filter((mood) =>
    MOOD_WORDS[mood].some((word) => words.has(word))
  );

  return [...new Set([...(PUBLISHER_MOODS[track.id] ?? []), ...labelled])];
}

const SAMPLE_RATE = 8000;
const BARS = 64;
const DIGITS = 36;
const here = path.dirname(fileURLToPath(import.meta.url));
const musicsDir = path.resolve(here, '../src/library/musics');
const outFile = path.resolve(here, '../src/music-profile.generated.json');
const beats = JSON.parse(readFileSync(path.resolve(here, '../src/music-beats.generated.json'), 'utf8')) as {
  tracks: Partial<Record<string, { bpm: number; usable: boolean }>>;
};

interface Measured {
  id: string;
  durationSec: number;
  peaks: string;
  bpm?: number;
  moods: Mood[];
}

function isLfsPointer(file: string): boolean {
  const fd = openSync(file, 'r');
  const head = Buffer.alloc(40);

  readSync(fd, head, 0, head.length, 0);
  closeSync(fd);

  return head.toString('utf8').startsWith('version https://git-lfs');
}

function decode(file: string): Int16Array {
  const pcm = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', '-'],
    {
      maxBuffer: 1 << 30,
    }
  );

  return new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
}

function peaksOf(samples: Int16Array): string {
  const size = Math.max(1, Math.floor(samples.length / BARS));
  const bars = Array.from({ length: BARS }, (_, bar) => {
    let sum = 0;
    const end = Math.min(samples.length, (bar + 1) * size);

    for (let i = bar * size; i < end; i += 1) sum += samples[i] ** 2;

    return Math.sqrt(sum / Math.max(1, end - bar * size));
  });
  const loudest = Math.max(1, ...bars);

  return bars.map((peak) => Math.round((peak / loudest) * (DIGITS - 1)).toString(DIGITS)).join('');
}

function measure(track: { id: string; file: string; title: string; sourceUrl: string }): Measured | string {
  const file = path.join(musicsDir, track.file);

  if (!existsSync(file)) return `${track.id} (missing)`;

  if (isLfsPointer(file)) return `${track.id} (Git LFS pointer)`;

  const samples = decode(file);
  const beat = beats.tracks[track.id];
  const bpm = beat?.usable ? Math.round(beat.bpm) : undefined;

  return {
    id: track.id,
    durationSec: Math.round(samples.length / SAMPLE_RATE),
    peaks: peaksOf(samples),
    ...(bpm === undefined ? {} : { bpm }),
    moods: moodsOf(track),
  };
}

const measured: Measured[] = [];
const skipped: string[] = [];

for (const track of [...MUSIC_LIBRARY].sort((a, b) => a.id.localeCompare(b.id))) {
  const result = measure(track);

  if (typeof result === 'string') skipped.push(result);

  if (typeof result !== 'string') measured.push(result);
}

const tracks = Object.fromEntries(
  measured.map((entry) => [
    entry.id,
    {
      durationSec: entry.durationSec,
      ...(entry.bpm === undefined ? {} : { bpm: entry.bpm }),
      ...(entry.moods.length > 0 ? { moods: entry.moods } : {}),
      peaks: entry.peaks,
    },
  ])
);

writeFileSync(
  outFile,
  `${JSON.stringify({ generatedBy: 'scripts/analyze-music-profile.ts', bars: BARS, tracks }, null, 2)}\n`
);
console.log(`Wrote ${measured.length} of ${MUSIC_LIBRARY.length} tracks to ${path.relative(process.cwd(), outFile)}`);

if (skipped.length > 0) console.log(`Skipped: ${skipped.join(', ')}`);
