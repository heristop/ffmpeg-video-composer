// Running whisper.cpp on a 16 kHz mono WAV: the CLI with DTW word alignment and a full JSON transcript
// (parsed by whisper-json.ts), or FFmpeg's `whisper` filter, which only times phrases (its words are
// spread over each phrase by length and flagged coarse). The process runner is injectable for tests.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RawWord } from '@/core/captions/word-timing';
import { parseWhisperJson } from './whisper-json';

export type ProcessRunner = (
  binary: string,
  args: string[],
  options?: { signal?: AbortSignal }
) => Promise<{ stdout: string; stderr: string }>;

export interface RawTranscript {
  language?: string;
  words: RawWord[];
}

const RUN_TIMEOUT_MS = 30 * 60_000;

export function runProcess(
  binary: string,
  args: string[],
  options: { signal?: AbortSignal } = {}
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      { maxBuffer: 64 * 1024 * 1024, timeout: RUN_TIMEOUT_MS, signal: options.signal },
      (error, stdout, stderr) => {
        if (error) {
          const tail = stderr.trim().split('\n').slice(-3).join(' | ');

          reject(new Error(`${path.basename(binary)} failed: ${tail || error.message}`));

          return;
        }

        resolve({ stdout, stderr });
      }
    );
  });
}

/**
 * whisper.cpp takes ISO 639 codes: "fr-FR" → "fr". Anything that isn't a 2–3 letter primary subtag falls back to
 * auto-detection: the value reaches FFmpeg's filtergraph, so it must never carry option or filter separators.
 */
export function whisperLanguage(language: string | undefined): string {
  const primary = (language ?? '').split(/[-_]/)[0]?.toLowerCase() ?? '';

  return /^[a-z]{2,3}$/.test(primary) ? primary : 'auto';
}

function tempBase(): { dir: string; base: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leclap-whisper-'));

  return { dir, base: path.join(dir, 'transcript') };
}

export interface CliRun {
  binary: string;
  wav: string;
  model: string;
  /** DTW alignment preset (the model's size); omitted for a custom model file. */
  modelName?: string;
  language?: string;
  threads?: number;
  run?: ProcessRunner;
  signal?: AbortSignal;
}

export async function runWhisperCli(options: CliRun): Promise<RawTranscript> {
  const { dir, base } = tempBase();
  const threads = options.threads ?? Math.max(1, Math.min(8, os.availableParallelism()));
  const args = [
    '-m',
    options.model,
    '-f',
    options.wav,
    '-l',
    whisperLanguage(options.language),
    '-t',
    String(threads),
    '-ojf',
    '-of',
    base,
    '-np',
    // DTW token alignment needs flash attention off.
    ...(options.modelName ? ['-dtw', options.modelName, '-nfa'] : []),
  ];

  try {
    await (options.run ?? runProcess)(options.binary, args, { signal: options.signal });

    return parseWhisperJson(JSON.parse(fs.readFileSync(`${base}.json`, 'utf8')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function phraseWords(phrase: { start: number; end: number; text: string }): RawWord[] {
  const texts = phrase.text.trim().split(/\s+/).filter(Boolean);
  const total = texts.reduce((sum, text) => sum + text.length + 1, 0);
  let cursor = phrase.start;

  return texts.map((text) => {
    const from = cursor;
    cursor += ((phrase.end - phrase.start) * (text.length + 1)) / Math.max(1, total);

    return { text, from, to: cursor, dtw: null };
  });
}

/** FFmpeg's whisper filter JSON lines ({"start":ms,"end":ms,"text":…}) → words spread over each phrase. */
export function parseFfmpegWhisper(output: string): RawWord[] {
  return output
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .flatMap((line) => {
      const phrase = JSON.parse(line) as { start: number; end: number; text: string };

      return phraseWords({ start: phrase.start / 1000, end: phrase.end / 1000, text: phrase.text });
    });
}

// A filtergraph option value, escaped at both levels FFmpeg parses: the option level (backslash, colon,
// quote), then the graph level (backslash, quote, comma, semicolon, brackets). Paths stay one inert value.
function escapeOption(value: string): string {
  const option = value.replace(/[\\:']/g, (char) => `\\${char}`);

  return option.replace(/[\\',;[\]]/g, (char) => `\\${char}`);
}

/** The single `whisper` filter: model, language (a validated code or auto), queue, JSON-lines destination. */
export function whisperFilterGraph(options: { model: string; language?: string; destination: string }): string {
  const language = whisperLanguage(options.language);

  return `whisper=model=${escapeOption(options.model)}:language=${language}:queue=10:destination=${escapeOption(options.destination)}:format=json`;
}

export interface FilterRun {
  ffmpeg: string;
  wav: string;
  model: string;
  language?: string;
  run?: ProcessRunner;
  signal?: AbortSignal;
}

export async function runFfmpegWhisper(options: FilterRun): Promise<RawTranscript> {
  const { dir, base } = tempBase();
  const destination = `${base}.jsonl`;
  const language = whisperLanguage(options.language);
  const graph = whisperFilterGraph({ model: options.model, language: options.language, destination });

  try {
    await (options.run ?? runProcess)(
      options.ffmpeg,
      ['-hide_banner', '-nostdin', '-v', 'error', '-i', options.wav, '-af', graph, '-f', 'null', '-'],
      { signal: options.signal }
    );

    const words = parseFfmpegWhisper(fs.readFileSync(destination, 'utf8'));

    return { ...(language === 'auto' ? {} : { language }), words };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
