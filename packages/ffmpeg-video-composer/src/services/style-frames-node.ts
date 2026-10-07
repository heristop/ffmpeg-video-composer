// Node-only frame decoding for the reference-style analyzer (core/style): ffmpeg decodes a reference
// image or clip into small rgb24 frames on stdout (`fps=…,scale=160:-2 -f rawvideo -pix_fmt rgb24`),
// which the pure analyzer turns into a theme and a style guide. Never imported by the browser or
// React Native entries; never writes to stdout itself, so the MCP server can call it safely.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { analyzeStyle } from '../core/style/analyze';
import type { StyleAnalysis, StyleFrame } from '../core/style/types';
import { FFmpegAvailability, FFmpegDetector } from '../platform/ffmpeg/FFmpegDetector';

export const STYLE_FRAME_WIDTH = 160;
/** Clips are sampled every 0.25 s, or evenly when that would exceed `maxFrames`. */
export const STYLE_SAMPLE_INTERVAL = 0.25;
export const STYLE_MAX_FRAMES = 240;
const DEFAULT_TIMEOUT_MS = 120_000;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff', '.gif', '.avif']);

export interface StyleFramesOptions {
  /** ffmpeg binary; detected (system, then ffmpeg-static) when omitted. */
  ffmpeg?: string;
  maxFrames?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface StyleFrames {
  kind: 'image' | 'clip';
  frames: StyleFrame[];
  /** Clip duration in seconds (clips only). */
  duration?: number;
}

interface RunResult {
  stdout: Buffer;
  stderr: string;
  code: number | null;
}

function run(binary: string, args: string[], options: StyleFramesOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], signal: options.signal });
    const chunks: Buffer[] = [];
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-64_000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout: Buffer.concat(chunks), stderr, code });
    });
  });
}

/** The ffmpeg the analyzer decodes with: system FFmpeg, else ffmpeg-static. */
export async function resolveStyleFfmpeg(): Promise<string> {
  const detected = await FFmpegDetector.detect();

  if (detected.availability === FFmpegAvailability.SYSTEM) return 'ffmpeg';

  if (detected.availability === FFmpegAvailability.STATIC && detected.path) return detected.path;

  throw new Error('No FFmpeg found: install FFmpeg (on PATH) or the ffmpeg-static package.');
}

/** `Duration: 00:01:02.50` from ffmpeg's input banner, in seconds (null for N/A). */
export function parseBannerDuration(stderr: string): number | null {
  const match = /Duration: (\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr);

  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
}

/** The size of the rawvideo output stream, from the `Output #0` section of ffmpeg's log. */
export function parseOutputSize(stderr: string): { width: number; height: number } | null {
  const output = stderr.slice(stderr.indexOf('Output #0'));
  const match = /Video: rawvideo[^\n]*?, (\d+)x(\d+)/.exec(output);

  return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
}

/** Sampling rate for a clip: 4 fps, or evenly spaced `maxFrames` across a long clip. */
export function sampleRateFor(duration: number, maxFrames: number): number {
  return duration / STYLE_SAMPLE_INTERVAL <= maxFrames ? 1 / STYLE_SAMPLE_INTERVAL : maxFrames / duration;
}

function isImagePath(file: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase());
}

function decodeArgs(file: string, filter: string, frames: number): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-i',
    file,
    '-map',
    '0:v:0',
    '-an',
    '-vf',
    filter,
    '-frames:v',
    String(frames),
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    'pipe:1',
  ];
}

function splitFrames(result: RunResult, fps: number | null): StyleFrame[] {
  const size = parseOutputSize(result.stderr);

  if (result.code !== 0 || !size) {
    const tail = result.stderr.trim().split('\n').slice(-3).join(' | ');

    throw new Error(`ffmpeg could not decode the reference: ${tail || `exit ${result.code}`}`);
  }

  const bytes = size.width * size.height * 3;
  const count = Math.floor(result.stdout.length / bytes);

  return Array.from({ length: count }, (_, i) => ({
    data: new Uint8Array(result.stdout.buffer, result.stdout.byteOffset + i * bytes, bytes),
    width: size.width,
    height: size.height,
    channels: 3 as const,
    ...(fps ? { time: Math.round((i / fps) * 1000) / 1000 } : {}),
  }));
}

async function probeDuration(ffmpeg: string, file: string, options: StyleFramesOptions): Promise<number | null> {
  // `ffmpeg -i` with no output exits non-zero by design; the banner is all that is needed.
  const { stderr } = await run(ffmpeg, ['-hide_banner', '-nostdin', '-i', file], options);

  if (!/Stream #\d+:\d+[^\n]*Video:/.test(stderr)) throw new Error(`No video stream in ${path.basename(file)}.`);

  return parseBannerDuration(stderr);
}

/** Decodes a reference image (one frame) or clip (frames every 0.25 s, at most `maxFrames`). */
export async function extractStyleFrames(file: string, options: StyleFramesOptions = {}): Promise<StyleFrames> {
  const ffmpeg = options.ffmpeg ?? (await resolveStyleFfmpeg());
  const scale = `scale=${STYLE_FRAME_WIDTH}:-2:flags=area`;
  const duration = isImagePath(file) ? null : await probeDuration(ffmpeg, file, options);

  if (duration === null || duration <= 0) {
    return { kind: 'image', frames: splitFrames(await run(ffmpeg, decodeArgs(file, scale, 1), options), null) };
  }

  const maxFrames = options.maxFrames ?? STYLE_MAX_FRAMES;
  const fps = sampleRateFor(duration, maxFrames);
  const filter = `fps=${fps.toFixed(6)},${scale}`;
  const frames = splitFrames(await run(ffmpeg, decodeArgs(file, filter, maxFrames), options), fps);

  return { kind: frames.length > 1 ? 'clip' : 'image', frames, duration };
}

/** Decodes and analyses a reference image or clip: its palette, texture and pacing as a theme. */
export async function analyzeStyleFile(
  file: string,
  options: StyleFramesOptions & { seed?: number } = {}
): Promise<StyleAnalysis> {
  const decoded = await extractStyleFrames(file, options);

  if (decoded.frames.length === 0) throw new Error(`ffmpeg decoded no frames from ${path.basename(file)}.`);

  return analyzeStyle({ ...decoded, seed: options.seed });
}
