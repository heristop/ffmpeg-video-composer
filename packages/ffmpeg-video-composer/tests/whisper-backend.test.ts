import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { detectWhisperBackend, transcriberUnavailable } from '@/services/transcribe-node/whisper-detect';
import { parseFfmpegWhisper, runFfmpegWhisper, runWhisperCli } from '@/services/transcribe-node/whisper-run';

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'speech',
  'whisper-cli-base-dtw.json'
);

describe('detectWhisperBackend', () => {
  const none = async () => null;
  const noFilters = async () => '';

  it('prefers an explicit LECLAP_WHISPER_CLI', async () => {
    const backend = await detectWhisperBackend({
      env: { LECLAP_WHISPER_CLI: '/opt/whisper/bin/whisper-cli' },
      which: none,
      listFilters: noFilters,
    });

    expect(backend).toEqual({ kind: 'whisper-cli', binary: '/opt/whisper/bin/whisper-cli' });
  });

  it('finds whisper-cli, then whisper-cpp, on PATH', async () => {
    const which = vi.fn(async (name: string) => (name === 'whisper-cpp' ? '/usr/bin/whisper-cpp' : null));

    expect(await detectWhisperBackend({ env: {}, which, listFilters: noFilters })).toEqual({
      kind: 'whisper-cli',
      binary: '/usr/bin/whisper-cpp',
    });
    expect(which.mock.calls.map(([name]) => name)).toEqual(['whisper-cli', 'whisper-cpp']);
  });

  it('falls back to an FFmpeg built with the whisper filter', async () => {
    const listFilters = async () => ' ... aresample A->A\n ... whisper A->A Transcribe audio using whisper.cpp.\n';

    expect(await detectWhisperBackend({ env: {}, which: none, listFilters, ffmpeg: '/usr/bin/ffmpeg' })).toEqual({
      kind: 'ffmpeg-filter',
      ffmpeg: '/usr/bin/ffmpeg',
    });
  });

  it('can be forced to the FFmpeg filter', async () => {
    const which = async () => '/usr/bin/whisper-cli';
    const listFilters = async () => ' ... whisper A->A\n';

    expect(
      await detectWhisperBackend({ env: { LECLAP_WHISPER_ENGINE: 'ffmpeg' }, which, listFilters, ffmpeg: 'ffmpeg' })
    ).toEqual({ kind: 'ffmpeg-filter', ffmpeg: 'ffmpeg' });
  });

  it('returns null without any transcriber, and explains how to install one', async () => {
    expect(await detectWhisperBackend({ env: {}, which: none, listFilters: noFilters })).toBeNull();
    expect(transcriberUnavailable().message).toMatch(/transcriber_unavailable.*whisper-cpp.*--enable-whisper/s);
  });
});

describe('runWhisperCli', () => {
  it('runs whisper.cpp with DTW word alignment and parses its JSON', async () => {
    const run = vi.fn(async (_binary: string, args: string[]) => {
      const out = args[args.indexOf('-of') + 1];
      fs.copyFileSync(FIXTURE, `${out}.json`);

      return { stdout: '', stderr: '' };
    });
    const result = await runWhisperCli({
      binary: 'whisper-cli',
      wav: '/tmp/in.wav',
      model: '/models/ggml-base.bin',
      modelName: 'base',
      language: 'en-US',
      run,
    });
    const args = run.mock.calls[0][1];

    expect(args).toEqual(expect.arrayContaining(['-m', '/models/ggml-base.bin', '-f', '/tmp/in.wav', '-ojf', '-np']));
    expect(args.slice(args.indexOf('-l'), args.indexOf('-l') + 2)).toEqual(['-l', 'en']);
    expect(args.slice(args.indexOf('-dtw'), args.indexOf('-dtw') + 2)).toEqual(['-dtw', 'base']);
    expect(result.language).toBe('en');
    expect(result.words).toHaveLength(14);
  });

  it('auto-detects the language when none is requested', async () => {
    const run = vi.fn(async (_binary: string, args: string[]) => {
      fs.copyFileSync(FIXTURE, `${args[args.indexOf('-of') + 1]}.json`);

      return { stdout: '', stderr: '' };
    });

    await runWhisperCli({ binary: 'whisper-cli', wav: 'in.wav', model: 'm.bin', modelName: 'tiny', run });

    const args = run.mock.calls[0][1];

    expect(args.slice(args.indexOf('-l'), args.indexOf('-l') + 2)).toEqual(['-l', 'auto']);
  });
});

describe('FFmpeg whisper filter', () => {
  it('parses its JSON lines into phrase-timed words', () => {
    const words = parseFfmpegWhisper(
      '{"start":500,"end":1500,"text":" Hello there"}\n{"start":2000,"end":2400,"text":"Bye."}\n'
    );

    expect(words.map((word) => word.text)).toEqual(['Hello', 'there', 'Bye.']);
    expect(words[0]).toMatchObject({ from: 0.5, dtw: null });
    expect(words[1].to).toBeCloseTo(1.5, 3);
    expect(words[2]).toMatchObject({ from: 2, to: 2.4 });
  });

  it('runs the filter into a JSON destination', async () => {
    const run = vi.fn(async (_binary: string, args: string[]) => {
      const graph = args[args.indexOf('-af') + 1];
      const destination = /destination=([^:]+)/.exec(graph)?.[1] as string;
      fs.writeFileSync(destination, '{"start":0,"end":800,"text":"Hi you"}\n');

      return { stdout: '', stderr: '' };
    });
    const result = await runFfmpegWhisper({
      ffmpeg: 'ffmpeg',
      wav: '/tmp/in.wav',
      model: '/models/ggml-base.bin',
      language: 'fr',
      run,
    });

    expect(run.mock.calls[0][1].join(' ')).toMatch(/whisper=model=\/models\/ggml-base\.bin:language=fr:.*format=json/);
    expect(result.words.map((word) => word.text)).toEqual(['Hi', 'you']);
    expect(result.language).toBe('fr');
  });
});
