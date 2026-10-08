// Node transcription of one media file with whisper.cpp: the first audio stream is extracted to a 16 kHz
// mono WAV with FFmpeg, whisper.cpp runs on it (whisper-detect.ts picks the CLI or FFmpeg's filter), and
// the word times are refined against the voiced spans of the same audio (core/captions/word-timing.ts).
// Local only: the audio never leaves the machine; the model is downloaded once, on an explicit opt-in.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Transcript } from '@/core/captions/transcript';
import type { TranscriptionService } from '../../director/transcribe-sections';
import { refineWordTimes } from '@/core/captions/word-timing';
import { speechSpans } from '@/core/audio/speech-spans';
import { decodeMonoPcm } from '../../platform/ffmpeg/decode-pcm-node';
import { detectWhisperBackend, transcriberUnavailable, type WhisperBackend } from './whisper-detect';
import { DEFAULT_WHISPER_MODEL, ensureWhisperModel, type WhisperModelName } from './whisper-models';
import { runFfmpegWhisper, runProcess, runWhisperCli, type RawTranscript } from './whisper-run';
import { fileDigest as hexDigest } from '../command-inputs-node';

const WHISPER_RATE = 16000;

export interface TranscribeDeps {
  detect: () => Promise<WhisperBackend | null>;
  ensureModel: typeof ensureWhisperModel;
  extractWav: (file: string, wav: string, ffmpeg: string, signal?: AbortSignal) => Promise<void>;
  decode: (wav: string) => Promise<{ samples: Float32Array; sampleRate: number }>;
  runCli: typeof runWhisperCli;
  runFilter: typeof runFfmpegWhisper;
}

export interface TranscribeMediaOptions {
  language?: string;
  model?: WhisperModelName;
  /** Download the model when missing (the explicit opt-in). */
  download?: boolean;
  /** FFmpeg binary (default `ffmpeg` on PATH). */
  ffmpeg?: string;
  signal?: AbortSignal;
  onDownloadProgress?: (received: number, total: number) => void;
  deps?: Partial<TranscribeDeps>;
}

/** sha256:<hex> of a file's bytes (the pin's clip digest; cached per path, size and mtime). */
export async function fileDigest(file: string): Promise<string> {
  return `sha256:${await hexDigest(file)}`;
}

async function extractWav(file: string, wav: string, ffmpeg: string, signal?: AbortSignal): Promise<void> {
  const args = ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-i', file, '-vn'];

  await runProcess(ffmpeg, [...args, '-ac', '1', '-ar', String(WHISPER_RATE), '-c:a', 'pcm_s16le', wav], { signal });
}

function defaults(options: TranscribeMediaOptions): TranscribeDeps {
  const ffmpeg = options.ffmpeg ?? 'ffmpeg';

  return {
    detect: () => detectWhisperBackend({ ffmpeg }),
    ensureModel: ensureWhisperModel,
    extractWav,
    decode: (wav) => decodeMonoPcm(wav, { ffmpeg, sampleRate: WHISPER_RATE, signal: options.signal }),
    runCli: runWhisperCli,
    runFilter: runFfmpegWhisper,
    ...options.deps,
  };
}

// The DTW preset of the model in use (a custom LECLAP_WHISPER_MODEL is named by its file, else no DTW).
function dtwPreset(model: string, name: WhisperModelName): string | undefined {
  if (!process.env.LECLAP_WHISPER_MODEL) return name;

  const match = /ggml-(tiny|base|small|medium)(\.en)?\.bin$/.exec(path.basename(model));

  return match ? match.slice(1).join('') : undefined;
}

async function runBackend(
  backend: WhisperBackend,
  deps: TranscribeDeps,
  run: { wav: string; model: string; name: WhisperModelName; options: TranscribeMediaOptions }
): Promise<RawTranscript> {
  const { wav, model, options } = run;

  if (backend.kind === 'ffmpeg-filter') {
    return deps.runFilter({ ffmpeg: backend.ffmpeg, wav, model, language: options.language, signal: options.signal });
  }

  const modelName = dtwPreset(model, run.name);

  return deps.runCli({
    binary: backend.binary,
    wav,
    model,
    modelName,
    language: options.language,
    signal: options.signal,
  });
}

/** Word-timed transcript of a media file's speech, times in the file's own seconds. */
export async function transcribeMediaFile(file: string, options: TranscribeMediaOptions = {}): Promise<Transcript> {
  const deps = defaults(options);
  const backend = await deps.detect();

  if (!backend) throw transcriberUnavailable();

  const name = options.model ?? DEFAULT_WHISPER_MODEL;
  const model = await deps.ensureModel(name, {
    download: options.download,
    signal: options.signal,
    onProgress: options.onDownloadProgress,
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leclap-transcribe-'));

  try {
    const wav = path.join(dir, 'audio.wav');
    await deps.extractWav(file, wav, options.ffmpeg ?? 'ffmpeg', options.signal);

    const raw = await runBackend(backend, deps, { wav, model, name, options });
    const { samples, sampleRate } = await deps.decode(wav);
    const words = refineWordTimes(raw.words, speechSpans(samples, sampleRate));
    const language = raw.language ?? options.language;
    const coarse = backend.kind === 'ffmpeg-filter';

    return {
      engine: coarse ? 'ffmpeg-whisper' : 'whisper.cpp',
      model: name,
      ...(language === undefined ? {} : { language }),
      ...(coarse ? { coarse } : {}),
      words,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** whisper.cpp as a transcription service (FFmpeg binary resolved per call). */
export function nodeTranscriptionService(ffmpeg?: () => string | undefined): TranscriptionService {
  return {
    transcribe: (file, request) =>
      transcribeMediaFile(file, {
        language: request.language,
        model: request.model,
        ffmpeg: ffmpeg?.(),
        signal: request.signal,
      }),
    digest: fileDigest,
  };
}
