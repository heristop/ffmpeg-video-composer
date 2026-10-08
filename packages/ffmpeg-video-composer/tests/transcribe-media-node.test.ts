import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { fileDigest, transcribeMediaFile, type TranscribeDeps } from '@/services/transcribe-node/transcribe-media-node';
import { whichOnPath } from '@/services/transcribe-node/whisper-detect';
import { WHISPER_MODELS, whisperCacheDir } from '@/services/transcribe-node/whisper-models';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'speech');
const CLIP = path.join(FIXTURES, 'captions-sentence.m4a');
const truth = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'captions-sentence.json'), 'utf8')) as {
  words: Array<{ text: string; start: number }>;
};

function voiced(seconds: number, from: number, to: number): Float32Array {
  const samples = new Float32Array(16000 * seconds);

  for (let index = 0; index < samples.length; index++) {
    const t = index / 16000;
    samples[index] = t >= from && t < to ? 0.3 * Math.sin(2 * Math.PI * 200 * t) : 0;
  }

  return samples;
}

function fakes(overrides: Partial<TranscribeDeps> = {}): Partial<TranscribeDeps> {
  return {
    detect: async () => ({ kind: 'whisper-cli', binary: 'whisper-cli' }),
    ensureModel: vi.fn(async () => '/models/ggml-base.bin'),
    extractWav: vi.fn(async () => undefined),
    decode: async () => ({ samples: voiced(2, 0.3, 1.5), sampleRate: 16000 }),
    runCli: vi.fn(async () => ({
      language: 'en',
      words: [
        { text: 'Hello', from: 0, to: 0.5, dtw: 0.8, confidence: 0.9 },
        { text: 'world.', from: 0.5, to: 1.2, dtw: 1.4, confidence: 0.7 },
      ],
    })),
    ...overrides,
  };
}

describe('transcribeMediaFile', () => {
  it('extracts the audio, runs whisper.cpp and returns refined words', async () => {
    const deps = fakes();
    const transcript = await transcribeMediaFile('clip.mp4', { model: 'base', download: true, deps });

    expect(deps.ensureModel).toHaveBeenCalledWith('base', expect.objectContaining({ download: true }));
    expect(transcript).toEqual({
      engine: 'whisper.cpp',
      model: 'base',
      language: 'en',
      words: [
        { text: 'Hello', start: 0.3, end: 0.8, confidence: 0.9 },
        { text: 'world.', start: 0.8, end: 1.4, confidence: 0.7 },
      ],
    });
  });

  it('marks FFmpeg filter transcripts as phrase-timed', async () => {
    const runFilter = vi.fn(async () => ({ words: [{ text: 'Hi', from: 0, to: 0.4, dtw: null }] }));
    const transcript = await transcribeMediaFile('clip.mp4', {
      language: 'fr',
      deps: fakes({ detect: async () => ({ kind: 'ffmpeg-filter', ffmpeg: 'ffmpeg' }), runFilter }),
    });

    expect(transcript).toMatchObject({ engine: 'ffmpeg-whisper', model: 'base', language: 'fr', coarse: true });
  });

  it('reports a host without whisper.cpp before touching the model', async () => {
    const deps = fakes({ detect: async () => null });

    await expect(transcribeMediaFile('clip.mp4', { deps })).rejects.toThrow(/transcriber_unavailable/);
    expect(deps.ensureModel).not.toHaveBeenCalled();
  });
});

describe('fileDigest', () => {
  it('hashes the clip bytes', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'digest-')), 'a.bin');
    fs.writeFileSync(file, 'abc');

    expect(await fileDigest(file)).toBe('sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

// The real thing: runs only where whisper.cpp is installed and the base model is already cached
// (`leclap transcribe --download-model` once). Skipped otherwise — CI has neither.
const cli = await whichOnPath('whisper-cli');
const model = path.join(whisperCacheDir(), WHISPER_MODELS.base.file);
const ready = cli !== null && fs.existsSync(model) && fs.statSync(model).size === WHISPER_MODELS.base.bytes;

function normalized(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
}

function wordErrors(expected: string[], actual: string[]): number {
  const row = Array.from({ length: actual.length + 1 }, (_, index) => index);

  for (const [i, word] of expected.entries()) {
    let diagonal = row[0];
    row[0] = i + 1;

    for (let j = 1; j <= actual.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (word === actual[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }

  return row[actual.length];
}

describe.runIf(ready)('whisper.cpp on the spoken fixture (needs whisper-cli + the cached base model)', () => {
  it('transcribes ≥ 90 % of the words, timed within ~100 ms', { timeout: 120_000 }, async () => {
    const started = Date.now();
    const transcript = await transcribeMediaFile(CLIP, { model: 'base', language: 'en' });
    const expected = truth.words.map((word) => normalized(word.text));
    const actual = transcript.words.map((word) => normalized(word.text));
    const accuracy = 1 - wordErrors(expected, actual) / expected.length;
    const offsets = transcript.words.flatMap((word, index) =>
      normalized(word.text) === expected[index] ? [Math.abs(word.start - truth.words[index].start)] : []
    );
    const meanOffset = offsets.reduce((sum, value) => sum + value, 0) / offsets.length;

    fs.writeFileSync(
      path.join(os.tmpdir(), 'leclap-transcribe-fixture.json'),
      JSON.stringify({ accuracy, meanOffset, maxOffset: Math.max(...offsets), ms: Date.now() - started }, null, 2)
    );

    expect(transcript.engine).toBe('whisper.cpp');
    expect(accuracy).toBeGreaterThanOrEqual(0.9);
    expect(meanOffset).toBeLessThan(0.1);
  });
});
