// Node-only measurement runs: spawn the adapter's own ffmpeg/ffprobe binaries and hand back their
// output, for the output QC (services/qc-node.ts), the true-peak guard (editor/utils/true-peak-guard.ts)
// and the version detection the colour tags and the caches depend on. Never imported by the browser or
// React Native entries.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseEbur128Summary } from '../../core/qc/parse';

const execFileAsync = promisify(execFile);

// A content pass over a long render logs one line per detector event; keep well clear of the 1 MiB default.
const MAX_BUFFER = 64 * 1024 * 1024;

/** Runs a binary and resolves its stdout and stderr; rejects with the stderr tail on a non-zero exit. */
export async function runMeasurement(
  binary: string,
  args: readonly string[]
): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(binary, [...args], { maxBuffer: MAX_BUFFER });

    return { stdout, stderr };
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? '';
    const tail = stderr.trim().split('\n').slice(-3).join(' | ');

    throw new Error(tail || (error instanceof Error ? error.message : String(error)));
  }
}

/** The ebur128 decode of a file's first audio stream: true peak (dBTP) and integrated loudness (LUFS). */
export async function measureLoudness(
  ffmpeg: string,
  file: string
): Promise<{ integrated: number | null; truePeak: number | null }> {
  const { stderr } = await runMeasurement(ffmpeg, [
    '-hide_banner',
    '-nostats',
    '-i',
    file,
    '-map',
    '0:a:0',
    '-af',
    'ebur128=peak=true:framelog=verbose',
    '-f',
    'null',
    '-',
  ]);

  return parseEbur128Summary(stderr);
}

const versionLines = new Map<string, Promise<string | null>>();

/** First line of `<ffmpeg> -version` (e.g. `ffmpeg version 7.1.1 Copyright …`), memoized per binary. */
export function ffmpegVersionLine(ffmpeg: string): Promise<string | null> {
  const cached = versionLines.get(ffmpeg);

  if (cached) return cached;

  const pending = runMeasurement(ffmpeg, ['-version'])
    .then(({ stdout }) => stdout.split('\n').at(0)?.trim() ?? null)
    .catch(() => null);
  versionLines.set(ffmpeg, pending);

  return pending;
}

const buildFeatures = new Map<string, Promise<{ fribidi: boolean; harfbuzz: boolean } | null>>();

/** The text libraries a `-buildconf` (or `-version`) dump says the binary was configured with. */
export function textFeaturesFromBuildconf(buildconf: string): { fribidi: boolean; harfbuzz: boolean } {
  return { fribidi: buildconf.includes('--enable-libfribidi'), harfbuzz: buildconf.includes('--enable-libharfbuzz') };
}

/**
 * Whether `<ffmpeg>` links libfribidi/libharfbuzz, from `-buildconf`; probed once per binary and cached.
 * Null when the binary can't be run, so the caller falls back to the conservative capability defaults.
 */
export function ffmpegTextFeatures(ffmpeg: string): Promise<{ fribidi: boolean; harfbuzz: boolean } | null> {
  const cached = buildFeatures.get(ffmpeg);

  if (cached) return cached;

  const pending = runMeasurement(ffmpeg, ['-hide_banner', '-buildconf'])
    .then(({ stdout }) => textFeaturesFromBuildconf(stdout))
    .catch(() => null);
  buildFeatures.set(ffmpeg, pending);

  return pending;
}

/** The version number from a `-version` first line (`7.1.1`, `n7.1`, `N-11834-g…`), or null. */
export function versionFromLine(line: string | null): string | null {
  return /ffmpeg version (\S+)/.exec(line ?? '')?.[1] ?? null;
}
