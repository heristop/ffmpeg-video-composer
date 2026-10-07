import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Pixel and audio goldens for real renders. `compareFrames` decodes both videos ONCE: each input keeps
 * only the requested frame indices (`select` by `n`), and `psnr` writes one stats line per compared
 * pair. Identical frames report `inf`. Frames under the threshold are dumped as PNG pairs to a temp dir
 * so a failure can be looked at. `compareAudio` subtracts one track from the other (phase-inverted
 * `amix`) and measures the residual's RMS level: `-Infinity` when the samples are identical.
 */

export interface FramePsnr {
  /** Frame index in the first video. */
  frame: number;
  /** Frame index in the second video. */
  frameB: number;
  /** Average PSNR over the planes, dB; `Infinity` for identical frames. */
  psnr: number;
}

export interface FrameComparison {
  frameCounts: [number, number];
  frames: FramePsnr[];
  /** Frames whose PSNR is under the threshold. */
  failing: FramePsnr[];
  /** Where the failing frames were written (`a-<n>.png` / `b-<n>.png`); null when none failed. */
  dumpDir: string | null;
}

export interface CompareOptions {
  /** Frame indices to compare (in the first video). */
  frames: number[];
  /** Matching indices in the second video, when they differ (e.g. a chunk against the whole render). */
  framesB?: number[];
  /** Minimum PSNR (dB) a frame must reach; default `Infinity` (bit-identical pixels). */
  minPsnr?: number;
  /** Compare videos of different lengths (default: a frame-count mismatch throws). */
  allowFrameCountMismatch?: boolean;
}

function run(binary: string, args: string[]): string {
  return execFileSync(binary, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Decoded video frame count (`ffprobe -count_frames`). */
export function frameCount(file: string): number {
  const entries = ['-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0'];
  const out = run('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', ...entries, file]);

  return Number.parseInt(out.trim(), 10);
}

function selectExpr(frames: number[]): string {
  return frames.map((frame) => `eq(n\\,${frame})`).join('+');
}

function parsePsnrStats(stats: string): number[] {
  return stats
    .split('\n')
    .filter((line) => line.includes('psnr_avg:'))
    .map((line) => {
      const value = /psnr_avg:(\S+)/.exec(line)?.[1] ?? 'nan';

      return value === 'inf' ? Number.POSITIVE_INFINITY : Number.parseFloat(value);
    });
}

function dumpFrame(file: string, frame: number, target: string): void {
  run('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vf', `select=eq(n\\,${frame})`, '-frames:v', '1', target]);
}

function dumpFailing(a: string, b: string, failing: FramePsnr[]): string | null {
  if (failing.length === 0) return null;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leclap-pixel-diff-'));

  for (const { frame, frameB } of failing) {
    dumpFrame(a, frame, path.join(dir, `a-${frame}.png`));
    dumpFrame(b, frameB, path.join(dir, `b-${frameB}.png`));
  }

  return dir;
}

/** Per-frame PSNR between two videos at the given frame indices, in one decode pass. */
export function compareFrames(a: string, b: string, options: CompareOptions): FrameComparison {
  const frameCounts: [number, number] = [frameCount(a), frameCount(b)];

  if (frameCounts[0] !== frameCounts[1] && !options.allowFrameCountMismatch) {
    throw new Error(`frame counts differ: ${frameCounts[0]} (${a}) vs ${frameCounts[1]} (${b})`);
  }

  const framesB = options.framesB ?? options.frames;
  const statsFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'leclap-psnr-')), 'psnr.log');
  // Re-stamp the selected frames 0..N-1 on both sides so psnr pairs them by order, not by source time.
  const graph =
    `[0:v]select='${selectExpr(options.frames)}',setpts=N/TB/30[a];` +
    `[1:v]select='${selectExpr(framesB)}',setpts=N/TB/30[b];` +
    `[a][b]psnr=stats_file=${statsFile}`;

  run('ffmpeg', ['-v', 'error', '-i', a, '-i', b, '-filter_complex', graph, '-f', 'null', '-']);

  const psnr = parsePsnrStats(fs.readFileSync(statsFile, 'utf8'));
  fs.rmSync(path.dirname(statsFile), { recursive: true, force: true });

  if (psnr.length !== options.frames.length) {
    throw new Error(`compared ${psnr.length} frames, expected ${options.frames.length}`);
  }

  const frames = psnr.map((value, index) => ({ frame: options.frames[index], frameB: framesB[index], psnr: value }));
  const failing = frames.filter((entry) => !(entry.psnr >= (options.minPsnr ?? Number.POSITIVE_INFINITY)));

  return { frameCounts, frames, failing, dumpDir: dumpFailing(a, b, failing) };
}

/** `count` frame indices spread evenly over `total` frames, first and last included. */
export function spreadFrames(total: number, count: number): number[] {
  if (count <= 1 || total <= 1) return [0];

  return [...new Set(Array.from({ length: count }, (_, i) => Math.round((i * (total - 1)) / (count - 1))))];
}

export interface AudioComparison {
  /** RMS level of (a − b), dBFS; `-Infinity` when the decoded samples are identical. */
  residualRmsDb: number;
  /** RMS level of a, dBFS, for scale. */
  referenceRmsDb: number;
}

function overallRms(log: string): number {
  const match = [...log.matchAll(/RMS level dB:\s*(-inf|-?[\d.]+)/g)].at(-1);

  if (!match) throw new Error('astats printed no RMS level');

  return match[1] === '-inf' ? Number.NEGATIVE_INFINITY : Number.parseFloat(match[1]);
}

/** Residual of the first audio streams of two files, sample by sample. */
export function compareAudio(a: string, b: string): AudioComparison {
  const stats = 'astats=metadata=0:measure_perchannel=none:measure_overall=RMS_level';
  const residual = `[1:a]volume=-1[inv];[0:a][inv]amix=inputs=2:normalize=0,${stats}`;

  return {
    residualRmsDb: overallRms(ffmpegStderr(['-i', a, '-i', b], residual)),
    referenceRmsDb: overallRms(ffmpegStderr(['-i', a], `[0:a]${stats}`)),
  };
}

// astats reports on stderr, which execFileSync only hands back on failure: capture it through a file.
function ffmpegStderr(args: string[], graph: string): string {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'leclap-astats-')), 'stderr.log');
  const fd = fs.openSync(out, 'w');

  try {
    execFileSync('ffmpeg', ['-hide_banner', '-nostats', ...args, '-filter_complex', graph, '-f', 'null', '-'], {
      stdio: ['ignore', 'ignore', fd],
    });
  } finally {
    fs.closeSync(fd);
  }

  const log = fs.readFileSync(out, 'utf8');
  fs.rmSync(path.dirname(out), { recursive: true, force: true });

  return log;
}
