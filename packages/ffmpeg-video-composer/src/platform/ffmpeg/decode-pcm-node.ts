// Node-only: decode any audio FFmpeg reads into mono 32-bit float PCM for the beat analyzer
// (core/audio/beats.ts), by piping `ffmpeg -f f32le -ac 1 -ar 22050 -` to memory. Never imported by the
// browser or React Native entries (they decode with Web Audio, or not at all).

import { execFile } from 'node:child_process';

/** The analyzer's sample rate: plenty for onsets and loudness, a quarter of the work of 44.1 kHz. */
export const ANALYSIS_SAMPLE_RATE = 22050;
// 10 minutes of mono float PCM at 22.05 kHz is ~53 MB.
const MAX_BUFFER = 256 * 1024 * 1024;
const DECODE_TIMEOUT_MS = 120_000;

export interface DecodeOptions {
  /** FFmpeg binary (default `ffmpeg` on PATH). */
  ffmpeg?: string;
  sampleRate?: number;
  /** Decode at most this many seconds. */
  maxSeconds?: number;
  signal?: AbortSignal;
}

function decodeArgs(file: string, sampleRate: number, maxSeconds: number | undefined): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-v',
    'error',
    '-i',
    file,
    ...(maxSeconds === undefined ? [] : ['-t', String(maxSeconds)]),
    '-vn',
    '-f',
    'f32le',
    '-ac',
    '1',
    '-ar',
    String(sampleRate),
    '-',
  ];
}

function toSamples(buffer: Buffer): Float32Array {
  const samples = new Float32Array(Math.floor(buffer.byteLength / 4));

  for (let index = 0; index < samples.length; index++) samples[index] = buffer.readFloatLE(index * 4);

  return samples;
}

/** Mono float PCM (-1..1) of the first audio stream of `file`, at `sampleRate` Hz. */
export function decodeMonoPcm(
  file: string,
  options: DecodeOptions = {}
): Promise<{ samples: Float32Array; sampleRate: number }> {
  const sampleRate = options.sampleRate ?? ANALYSIS_SAMPLE_RATE;
  const args = decodeArgs(file, sampleRate, options.maxSeconds);

  return new Promise((resolve, reject) => {
    execFile(
      options.ffmpeg ?? 'ffmpeg',
      args,
      { encoding: 'buffer', maxBuffer: MAX_BUFFER, timeout: DECODE_TIMEOUT_MS, signal: options.signal },
      (error, stdout, stderr) => {
        if (error) {
          const tail = stderr.toString('utf8').trim().split('\n').slice(-2).join(' | ');

          reject(new Error(`could not decode ${file}: ${tail || error.message}`));

          return;
        }

        resolve({ samples: toSamples(stdout), sampleRate });
      }
    );
  });
}
