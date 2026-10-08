import { describe, expect, it } from 'vitest';
import { transcriptSrt } from '@/core/captions/transcript-srt';
import { parseSrt } from '@/core/captions/srt';

const words = (...spans: Array<[string, number, number]>) => spans.map(([text, start, end]) => ({ text, start, end }));

// The words whisper.cpp pinned for the auto-captions PR clip (.github/pr-media/auto-captions/talk.pinned.json).
const TALK = words(
  ['Every', 0.4, 0.58],
  ['word', 0.58, 0.86],
  ['you', 0.86, 1],
  ['say', 1, 1.44],
  ['becomes', 1.44, 1.68],
  ['a', 1.82, 1.88],
  ['caption,', 1.88, 2.52],
  ['the', 2.54, 2.62],
  ['speech', 2.76, 2.96],
  ['is', 2.97, 3.08],
  ['transcribed', 3.19, 3.8],
  ['on', 3.8, 3.94],
  ['your', 3.94, 4.06],
  ['own', 4.06, 4.3],
  ['machine,', 4.3, 4.74],
  ['the', 5.09, 5.18],
  ['words', 5.18, 5.42],
  ['are', 5.45, 5.56],
  ['pinned', 5.57, 5.84],
  ['in', 5.88, 6],
  ['the', 6, 6.08],
  ['template,', 6.13, 6.6],
  ['and', 6.86, 6.96],
  ['the', 7, 7.06],
  ['next', 7.18, 7.38],
  ['render', 7.43, 7.68],
  ['looks', 7.8, 7.96],
  ['exactly', 8.17, 8.48],
  ['the', 8.54, 8.66],
  ['same.', 8.76, 9.04]
);

function cueTexts(srt: string): string[] {
  return srt
    .trim()
    .split('\n\n')
    .map((cue) => cue.split('\n').slice(2).join(' '));
}

describe('transcriptSrt', () => {
  it('breaks the talk at its punctuation and pauses, never mid-phrase', () => {
    const srt = transcriptSrt(TALK);

    expect(srt).toBe(
      [
        '1\n00:00:00,400 --> 00:00:02,520\nEvery word you say becomes a caption,\n',
        '2\n00:00:02,540 --> 00:00:04,740\nthe speech is transcribed\non your own machine,\n',
        '3\n00:00:05,090 --> 00:00:06,600\nthe words are pinned in the template,\n',
        '4\n00:00:06,860 --> 00:00:09,040\nand the next render\nlooks exactly the same.\n',
      ].join('\n')
    );
    expect(parseSrt(srt).errors).toEqual([]);
  });

  it('ends a cue at a pause of 0.3 s or more', () => {
    const srt = transcriptSrt(words(['so', 0, 0.2], ['then', 0.25, 0.5], ['later', 0.8, 1.1], ['on', 1.15, 1.3]));

    expect(cueTexts(srt)).toEqual(['so then', 'later on']);
  });

  it('caps a cue that never pauses at two lines of 42 characters and 7 seconds', () => {
    const long = Array.from(
      { length: 40 },
      (_, index) => ['word' + index, index * 0.3, index * 0.3 + 0.28] as [string, number, number]
    );
    const srt = transcriptSrt(words(...long));
    const cues = srt.trim().split('\n\n');

    expect(cues.length).toBeGreaterThan(1);

    for (const cue of cues) {
      const [, timing, ...lines] = cue.split('\n');
      const [from, to] = parseSrt(`1\n${timing}\nx\n`).cues.map((parsed) => [parsed.start, parsed.end])[0];

      expect(lines.length).toBeLessThanOrEqual(2);
      expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(42);
      expect(to - from).toBeLessThanOrEqual(7);
    }
  });

  it('never leaves a single word on its own', () => {
    const srt = transcriptSrt(
      words(['Well,', 0, 0.3], ['I', 0.35, 0.4], ['think', 0.45, 0.7], ['so.', 0.75, 1], ['Yes.', 2, 2.3])
    );

    expect(cueTexts(srt)).toEqual(['Well, I think so. Yes.']);
  });

  it('is empty without words', () => {
    expect(transcriptSrt([])).toBe('');
  });
});
