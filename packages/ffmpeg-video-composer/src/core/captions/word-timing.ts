// Word times from a recogniser's raw output. whisper.cpp's token timestamps run early and drift; its DTW
// alignment (`--dtw <model>`) lands close to where each word ENDS, with the odd slip. So a word ends on
// its DTW time, starts where the previous word ended (or where speech resumes after a pause, from the
// voiced spans of the audio), and a run of words whose implied lengths are implausible for their letters
// (one word swallowing a second, the next squeezed to nothing) shares its window by length instead.
// Pure; times in seconds, millisecond-rounded.

import type { TranscriptWord } from './transcript-time';

export interface RawWord {
  text: string;
  /** Recogniser timestamps of the word (its first token's start, last token's end). */
  from: number;
  to: number;
  /** DTW alignment time of the word's last spoken token, or null without DTW. */
  dtw: number | null;
  confidence?: number;
}

/** A word lasts at least this long per letter, */
const MIN_PER_LETTER = 0.045;
/** and at most this long per letter plus HOLD_SLACK. */
const MAX_PER_LETTER = 0.11;
const HOLD_SLACK = 0.15;
/** A new voiced span must start this long before a word's end to be its onset. */
const ONSET_MARGIN = 0.08;

function ms(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function letters(text: string): number {
  return Math.max(1, text.replace(/[^\p{L}\p{N}]/gu, '').length);
}

function plausible(word: TranscriptWord): boolean {
  const duration = word.end - word.start;
  const count = letters(word.text);

  return duration >= MIN_PER_LETTER * count && duration <= HOLD_SLACK + MAX_PER_LETTER * count;
}

// The start of the last voiced span that begins before `end` (minus the margin), or 0.
function onsetBefore(spans: ReadonlyArray<readonly [number, number]>, end: number): number {
  let onset = 0;

  for (const [start] of spans) {
    if (start < end - ONSET_MARGIN) onset = start;
  }

  return onset;
}

function anchored(raw: readonly RawWord[], spans: ReadonlyArray<readonly [number, number]>): TranscriptWord[] {
  const words: TranscriptWord[] = [];
  let previousEnd = 0;

  for (const word of raw) {
    const end = Math.max(word.dtw ?? word.to, previousEnd);
    const start = Math.min(end, Math.max(previousEnd, word.from, onsetBefore(spans, end)));

    words.push({
      text: word.text,
      start,
      end,
      ...(word.confidence === undefined ? {} : { confidence: word.confidence }),
    });
    previousEnd = end;
  }

  return words;
}

// Share [first.start, last.end] of a run by letters + 1 (short words take longer per letter).
function spread(words: TranscriptWord[], from: number, to: number): void {
  const weights = words.slice(from, to + 1).map((word) => letters(word.text) + 1);
  const total = weights.reduce((sum, value) => sum + value, 0);
  const window = words[to].end - words[from].start;
  let cursor = words[from].start;

  for (const [offset, weight] of weights.entries()) {
    const word = words[from + offset];
    word.start = cursor;
    cursor += (window * weight) / total;
    word.end = offset === weights.length - 1 ? word.end : cursor;
  }
}

// A word starting after a pause is anchored on the speech onset: runs never share time across it.
function afterPause(words: readonly TranscriptWord[], index: number): boolean {
  return index > 0 && index < words.length && words[index].start > words[index - 1].end + 0.001;
}

function repairRuns(words: TranscriptWord[]): void {
  let runStart = -1;

  for (let index = 0; index <= words.length; index++) {
    const bad = index < words.length && !plausible(words[index]);

    if (runStart >= 0 && (!bad || afterPause(words, index))) {
      if (index - 1 > runStart) spread(words, runStart, index - 1);

      runStart = -1;
    }

    if (bad && runStart < 0) runStart = index;
  }
}

// Without DTW: the recogniser's own times, each word ending no later than the next one starts.
function segmentTimed(raw: readonly RawWord[]): TranscriptWord[] {
  return raw.map((word, index) => {
    const next = index + 1 < raw.length ? raw[index + 1] : undefined;
    const end = next ? Math.min(word.to, next.from) : word.to;

    return {
      text: word.text,
      start: word.from,
      end: Math.max(word.from, end),
      ...(word.confidence === undefined ? {} : { confidence: word.confidence }),
    };
  });
}

/** Section-ready word times from raw recogniser words and the voiced spans of the same audio. */
export function refineWordTimes(
  raw: readonly RawWord[],
  spans: ReadonlyArray<readonly [number, number]>
): TranscriptWord[] {
  const hasDtw = raw.some((word) => word.dtw !== null);
  const words = hasDtw ? anchored(raw, spans) : segmentTimed(raw);

  if (hasDtw) repairRuns(words);

  return words.map((word) => ({ ...word, start: ms(word.start), end: ms(word.end) }));
}
