import { describe, expect, it } from 'vitest';
import { editPinnedWord, isUnsure } from './pinned-words';

const subtitles = {
  style: 'loud' as const,
  words: [
    { text: 'Captions', start: 0.2, end: 0.7, confidence: 0.9 },
    { text: 'write', start: 0.7, end: 1, confidence: 0.4 },
  ],
};

describe('editPinnedWord', () => {
  it('fixes one word and keeps its timing', () => {
    expect(editPinnedWord(subtitles, 1, ' right ').words).toEqual([
      subtitles.words[0],
      { text: 'right', start: 0.7, end: 1 },
    ]);
  });

  it('drops a word cleared to nothing', () => {
    expect(editPinnedWord(subtitles, 0, '  ').words).toEqual([subtitles.words[1]]);
  });

  it('keeps the input untouched and ignores an unchanged word', () => {
    expect(editPinnedWord(subtitles, 0, 'Captions')).toBe(subtitles);
    expect(subtitles.words[1].text).toBe('write');
  });
});

describe('isUnsure', () => {
  it('flags words the recogniser was unsure of', () => {
    expect(isUnsure(subtitles.words[1])).toBe(true);
    expect(isUnsure(subtitles.words[0])).toBe(false);
    expect(isUnsure({ text: 'x', start: 0, end: 1 })).toBe(false);
  });
});
