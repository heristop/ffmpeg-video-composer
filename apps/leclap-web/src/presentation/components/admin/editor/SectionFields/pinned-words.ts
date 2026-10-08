// Fixing a pinned transcript in the builder: a word's text changes, its timing never does (the timing is
// the recogniser's; a fixed spelling is the author's). A word cleared to nothing is dropped. The fixed
// word loses its confidence score: it is now authored, not recognised.
import type { Subtitles } from 'ffmpeg-video-composer/src/schemas/subtitles.schemas.ts';

type Word = NonNullable<Subtitles['words']>[number];

/** Below this confidence a pinned word is shown as worth a second look. */
const UNSURE = 0.6;

export function isUnsure(word: Word): boolean {
  return word.confidence !== undefined && word.confidence < UNSURE;
}

export function editPinnedWord(subtitles: Subtitles, index: number, text: string): Subtitles {
  const words = subtitles.words ?? [];
  const next = text.trim();
  const word = index >= 0 && index < words.length ? words[index] : undefined;

  if (!word || next === word.text) return subtitles;

  if (!next) return { ...subtitles, words: words.filter((_, at) => at !== index) };

  return {
    ...subtitles,
    words: words.map((candidate, at) =>
      at === index ? { text: next, start: candidate.start, end: candidate.end } : candidate
    ),
  };
}
