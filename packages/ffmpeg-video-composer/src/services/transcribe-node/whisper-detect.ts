// Which whisper.cpp the Node host can run, in order:
// 1. LECLAP_WHISPER_CLI: an explicit whisper.cpp CLI binary.
// 2. `whisper-cli`, then `whisper-cpp`, on PATH (Homebrew's whisper-cpp, a source build): word timings
//    come from its DTW alignment.
// 3. An FFmpeg built with `--enable-whisper` (FFmpeg 8+ `whisper` audio filter): phrase timings only,
//    spread over the words (coarse).
// LECLAP_WHISPER_ENGINE=cli|ffmpeg forces one. Nothing is compiled or installed here.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type WhisperBackend = { kind: 'whisper-cli'; binary: string } | { kind: 'ffmpeg-filter'; ffmpeg: string };

type Env = Record<string, string | undefined>;

export interface DetectOptions {
  env?: Env;
  /** FFmpeg binary whose filters are probed (default `ffmpeg`). */
  ffmpeg?: string;
  which?: (name: string) => Promise<string | null>;
  listFilters?: (ffmpeg: string) => Promise<string>;
}

const CLI_NAMES = ['whisper-cli', 'whisper-cpp'];

/** First executable `name` on PATH, or null. */
export async function whichOnPath(name: string, env: Env = process.env): Promise<string | null> {
  const candidates = (env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .map((dir) => path.join(dir, name));
  const runnable = await Promise.all(
    candidates.map((candidate) =>
      fs.promises.access(candidate, fs.constants.X_OK).then(
        () => true,
        () => false
      )
    )
  );

  return candidates.find((_, index) => runnable[index]) ?? null;
}

/** `ffmpeg -filters`, or '' when the binary cannot run. */
export function ffmpegFilters(ffmpeg: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(ffmpeg, ['-hide_banner', '-filters'], { timeout: 15_000 }, (error, stdout) => {
      resolve(error ? '' : stdout);
    });
  });
}

async function findCli(env: Env, which: (name: string) => Promise<string | null>): Promise<string | null> {
  if (env.LECLAP_WHISPER_CLI) return env.LECLAP_WHISPER_CLI;

  const found = await Promise.all(CLI_NAMES.map((name) => which(name)));

  return found.find((binary): binary is string => binary !== null) ?? null;
}

/** The whisper backend to run, or null when this host has none. */
export async function detectWhisperBackend(options: DetectOptions = {}): Promise<WhisperBackend | null> {
  const env = options.env ?? process.env;
  const ffmpeg = options.ffmpeg ?? 'ffmpeg';
  const forced = env.LECLAP_WHISPER_ENGINE;
  const binary = forced === 'ffmpeg' ? null : await findCli(env, options.which ?? ((name) => whichOnPath(name, env)));

  if (binary) return { kind: 'whisper-cli', binary };

  if (forced === 'cli') return null;

  const filters = await (options.listFilters ?? ffmpegFilters)(ffmpeg);

  return /\swhisper\s+A->A/.test(filters) ? { kind: 'ffmpeg-filter', ffmpeg } : null;
}

/** The error a host without any transcriber reports. */
export function transcriberUnavailable(): Error {
  return new Error(
    'transcriber_unavailable: no whisper.cpp found. Install the whisper.cpp CLI (macOS: `brew install whisper-cpp`; ' +
      'Linux: build https://github.com/ggml-org/whisper.cpp and put `whisper-cli` on PATH, or set LECLAP_WHISPER_CLI), ' +
      'or use an FFmpeg 8 built with --enable-whisper. Or pin the words yourself in subtitles.words.'
  );
}
