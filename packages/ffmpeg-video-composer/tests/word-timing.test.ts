import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { refineWordTimes, type RawWord } from '@/core/captions/word-timing';
import { speechSpans } from '@/core/audio/speech-spans';
import { parseWhisperJson } from '@/services/transcribe-node/whisper-json';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'speech');
const whisper = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'whisper-cli-base-dtw.json'), 'utf8'));
const truth = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'captions-sentence.json'), 'utf8')) as {
  words: Array<{ text: string; start: number }>;
};

const raw = (text: string, from: number, to: number, dtw: number | null, confidence = 0.9): RawWord => ({
  text,
  from,
  to,
  dtw,
  confidence,
});

describe('parseWhisperJson', () => {
  it('joins sub-word tokens into words, keeps punctuation and skips special tokens', () => {
    const parsed = parseWhisperJson(whisper);

    expect(parsed.language).toBe('en');
    expect(parsed.words.map((word) => word.text)).toEqual(truth.words.map((word) => word.text));
    expect(parsed.words[0]).toMatchObject({ text: 'Captions', from: 0, to: 0.6, dtw: 1 });
    expect(parsed.words[0].confidence).toBeCloseTo((0.899144 + 0.976798) / 2, 3);
    // The comma after "screen" is part of the word, but its own DTW time never stretches the word.
    expect(parsed.words[9]).toMatchObject({ text: 'screen,', dtw: 3.52 });
  });

  it('reads a transcript without DTW times', () => {
    const json = {
      result: { language: 'fr' },
      transcription: [{ tokens: [{ text: ' Bonjour', offsets: { from: 100, to: 600 }, p: 0.8 }] }],
    };

    expect(parseWhisperJson(json)).toEqual({
      language: 'fr',
      words: [{ text: 'Bonjour', from: 0.1, to: 0.6, dtw: null, confidence: 0.8 }],
    });
  });

  it('rejects output that is not a whisper.cpp transcript', () => {
    expect(() => parseWhisperJson({ nope: true })).toThrow(/whisper/);
  });
});

describe('refineWordTimes', () => {
  it('ends words on their DTW time and starts them where the previous ended', () => {
    const words = refineWordTimes([raw('one', 0, 0.3, 0.42), raw('two', 0.3, 0.6, 0.8)], [[0.1, 0.9]]);

    expect(words).toEqual([
      { text: 'one', start: 0.1, end: 0.42, confidence: 0.9 },
      { text: 'two', start: 0.42, end: 0.8, confidence: 0.9 },
    ]);
  });

  it('starts a word after a pause where the speech resumes', () => {
    const words = refineWordTimes(
      [raw('stop.', 0, 0.4, 0.5), raw('Go', 0.5, 0.9, 1.4)],
      [
        [0.05, 0.55],
        [1.1, 1.45],
      ]
    );

    expect(words[1]).toMatchObject({ start: 1.1, end: 1.4 });
  });

  it('spreads a run of implausibly timed words over their window by length', () => {
    // "text" claims 0.8 s and "on" 0.02 s: the aligner slipped; share the window instead.
    const words = refineWordTimes(
      [raw('ok', 0, 0.2, 0.3), raw('text', 0.3, 0.5, 1.1), raw('on', 0.5, 0.7, 1.12)],
      [[0, 1.2]]
    );

    // Shared by letters + 1: "text" takes 5/8 of 0.82 s, "on" 3/8.
    expect(words[0]).toMatchObject({ start: 0, end: 0.3 });
    expect(words[1].start).toBe(0.3);
    expect(words[1].end).toBeCloseTo(0.8125, 2);
    expect(words[2].start).toBe(words[1].end);
    expect(words[2].end).toBe(1.12);
  });

  it('falls back to the recogniser segment times without DTW', () => {
    expect(refineWordTimes([raw('hi', 0.2, 0.5, null), raw('you', 0.4, 0.9, null)], [])).toEqual([
      { text: 'hi', start: 0.2, end: 0.4, confidence: 0.9 },
      { text: 'you', start: 0.4, end: 0.9, confidence: 0.9 },
    ]);
  });

  it('times the TTS fixture within ~100 ms on average', () => {
    const spans: Array<[number, number]> = [
      [0.51, 3.66],
      [3.84, 4.79],
    ];
    const words = refineWordTimes(parseWhisperJson(whisper).words, spans);
    const errors = words.map((word, index) => Math.abs(word.start - truth.words[index].start));
    const mean = errors.reduce((sum, value) => sum + value, 0) / errors.length;

    expect(mean).toBeLessThan(0.06);
    expect(Math.max(...errors)).toBeLessThan(0.15);
  });
});

describe('speechSpans', () => {
  it('finds the voiced stretches of a signal', () => {
    const rate = 16000;
    const samples = new Float32Array(rate * 2);

    for (let index = 0; index < samples.length; index++) {
      const t = index / rate;
      const voiced = (t >= 0.5 && t < 1) || (t >= 1.4 && t < 1.8);

      samples[index] = voiced ? 0.3 * Math.sin(2 * Math.PI * 220 * t) : 0.0005 * Math.sin(index);
    }

    const spans = speechSpans(samples, rate);

    expect(spans).toHaveLength(2);
    expect(spans[0][0]).toBeCloseTo(0.5, 1);
    expect(spans[0][1]).toBeCloseTo(1, 1);
    expect(spans[1][0]).toBeCloseTo(1.4, 1);
  });

  it('handles long audio without overflowing the stack (2M frames)', () => {
    // 50 Hz: one sample per 20 ms frame, so 2M samples are 2M frames (11 hours; a spread overflows far sooner).
    const samples = new Float32Array(2_000_000);

    samples.fill(0.3, 100_000, 100_050);

    expect(speechSpans(samples, 50)).toEqual([[2000, 2001]]);
  });

  it('is empty on silence', () => {
    expect(speechSpans(new Float32Array(16000), 16000)).toEqual([]);
  });
});
