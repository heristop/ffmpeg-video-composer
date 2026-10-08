// whisper.cpp ggml models: never bundled, downloaded once on an explicit opt-in (`--download-model`,
// `download: true` or LECLAP_WHISPER_DOWNLOAD=1) from the official ggerganov/whisper.cpp repository into a
// user cache, and SHA-256-verified before use: a download is hashed as it streams in, a cached file once,
// after which a `<model>.sha256` marker beside it stands for the check (until the model file changes).
// LECLAP_WHISPER_MODEL points at a model file of your own.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { TRANSCRIBE_MODELS } from '../../schemas/transcribe.schemas';

export type WhisperModelName = (typeof TRANSCRIBE_MODELS)[number];

export interface WhisperModelSpec {
  file: string;
  sha256: string;
  bytes: number;
  url: string;
}

const REPO = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

// SHA-256 of the multilingual models, as published (git LFS oid) on huggingface.co/ggerganov/whisper.cpp.
export const WHISPER_MODELS: Record<WhisperModelName, WhisperModelSpec> = {
  tiny: {
    file: 'ggml-tiny.bin',
    sha256: 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21',
    bytes: 77_691_713,
    url: `${REPO}/ggml-tiny.bin`,
  },
  base: {
    file: 'ggml-base.bin',
    sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',
    bytes: 147_951_465,
    url: `${REPO}/ggml-base.bin`,
  },
  small: {
    file: 'ggml-small.bin',
    sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b',
    bytes: 487_601_967,
    url: `${REPO}/ggml-small.bin`,
  },
};

export const DEFAULT_WHISPER_MODEL: WhisperModelName = 'base';

type Env = Record<string, string | undefined>;

/** Where models are cached: LECLAP_WHISPER_DIR, else $XDG_CACHE_HOME/leclap/whisper, else ~/.cache/leclap/whisper. */
export function whisperCacheDir(env: Env = process.env, home = os.homedir()): string {
  if (env.LECLAP_WHISPER_DIR) return env.LECLAP_WHISPER_DIR;

  return path.join(env.XDG_CACHE_HOME ?? path.join(home, '.cache'), 'leclap', 'whisper');
}

export interface EnsureModelOptions {
  /** Download the model when it is missing (the explicit opt-in). */
  download?: boolean;
  dir?: string;
  fetch?: typeof fetch;
  env?: Env;
  /** Model table (tests). */
  models?: Partial<Record<WhisperModelName, WhisperModelSpec>>;
  onProgress?: (received: number, total: number) => void;
  signal?: AbortSignal;
}

function isComplete(file: string, spec: WhisperModelSpec): boolean {
  try {
    return fs.statSync(file).size === spec.bytes;
  } catch {
    return false;
  }
}

function markerOf(file: string): string {
  return `${file}.sha256`;
}

// The marker vouches for the model only if it holds the expected digest and was written after the model.
function hasMarker(file: string, spec: WhisperModelSpec): boolean {
  try {
    const marker = markerOf(file);

    return (
      fs.readFileSync(marker, 'utf8').trim() === spec.sha256 && fs.statSync(marker).mtimeMs >= fs.statSync(file).mtimeMs
    );
  } catch {
    return false;
  }
}

function writeMarker(file: string, spec: WhisperModelSpec): void {
  fs.writeFileSync(markerOf(file), `${spec.sha256}\n`);
}

async function sha256Of(file: string): Promise<string> {
  const hash = crypto.createHash('sha256');

  await pipeline(fs.createReadStream(file), hash);

  return hash.digest('hex');
}

// A cached model of the right size: trusted on its marker, else hashed once and marked.
async function isVerified(file: string, spec: WhisperModelSpec): Promise<boolean> {
  if (!isComplete(file, spec)) return false;

  if (hasMarker(file, spec)) return true;

  if ((await sha256Of(file)) !== spec.sha256) return false;

  writeMarker(file, spec);

  return true;
}

function missing(name: string, spec: WhisperModelSpec, dir: string): Error {
  const megabytes = Math.round(spec.bytes / 1_000_000);

  return new Error(
    `whisper_model_missing: the whisper "${name}" model (${megabytes} MB) is not downloaded. Run again with ` +
      `--download-model (or set LECLAP_WHISPER_DOWNLOAD=1) to fetch it once from ${spec.url} into ${dir} ` +
      '(checksum-verified; your audio never leaves this machine), or point LECLAP_WHISPER_MODEL at a ggml model file.'
  );
}

// Streams the body to a temporary file of this download's own (never a shared `.part`), hashing it on the
// way with backpressure; a write error (ENOENT, EACCES, ENOSPC) rejects instead of crashing the process,
// and every failure removes the temporary file.
async function download(spec: WhisperModelSpec, target: string, options: EnsureModelOptions): Promise<void> {
  const response = await (options.fetch ?? fetch)(spec.url, { signal: options.signal });

  if (!response.ok || !response.body) throw new Error(`model download failed: HTTP ${response.status} for ${spec.url}`);

  const partial = `${target}.${process.pid}.${crypto.randomUUID()}.part`;
  const hash = crypto.createHash('sha256');
  let received = 0;
  const hashing = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      received += chunk.byteLength;
      options.onProgress?.(received, spec.bytes);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(response.body as unknown as WebReadableStream<Uint8Array>),
      hashing,
      fs.createWriteStream(partial),
      { signal: options.signal }
    );

    const digest = hash.digest('hex');

    if (digest !== spec.sha256) {
      throw new Error(`model checksum mismatch for ${spec.file}: got ${digest}, expected ${spec.sha256}`);
    }

    fs.renameSync(partial, target);
    writeMarker(target, spec);
  } finally {
    fs.rmSync(partial, { force: true });
  }
}

/** Path of a verified local model file; downloads it first only with the explicit opt-in. */
export async function ensureWhisperModel(name: WhisperModelName, options: EnsureModelOptions = {}): Promise<string> {
  const env = options.env ?? process.env;

  if (env.LECLAP_WHISPER_MODEL) return env.LECLAP_WHISPER_MODEL;

  const spec = (options.models ?? WHISPER_MODELS)[name];

  if (!spec) throw new Error(`unknown whisper model "${name}" (use tiny, base or small)`);

  const dir = options.dir ?? whisperCacheDir(env);
  const target = path.join(dir, spec.file);

  if (await isVerified(target, spec)) return target;

  if (!(options.download || env.LECLAP_WHISPER_DOWNLOAD === '1')) throw missing(name, spec, dir);

  fs.mkdirSync(dir, { recursive: true });
  await download(spec, target, options);

  return target;
}
