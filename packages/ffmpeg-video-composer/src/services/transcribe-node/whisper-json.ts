// whisper.cpp's `--output-json-full` transcript → raw words. Tokens starting with a space open a word,
// the others (sub-words, punctuation) extend it; `[_BEG_]`-style special tokens are skipped. A word's
// DTW time is its last SPOKEN token's (punctuation tokens align to the pause after it). Pure.

import type { RawWord } from '@/core/captions/word-timing';

interface WhisperToken {
  text?: unknown;
  offsets?: { from?: unknown; to?: unknown };
  p?: unknown;
  t_dtw?: unknown;
}

interface WhisperJson {
  result?: { language?: unknown };
  transcription?: Array<{ tokens?: WhisperToken[] }>;
}

interface Building {
  text: string;
  from: number;
  to: number;
  dtw: number | null;
  scores: number[];
}

const SPECIAL = /^\[_.*\]$|^<\|.*\|>$/;
const PUNCTUATION = /^[\p{P}\s]+$/u;

function seconds(value: unknown): number {
  return typeof value === 'number' ? value / 1000 : 0;
}

function finish(word: Building): RawWord {
  const confidence = word.scores.reduce((sum, value) => sum + value, 0) / Math.max(1, word.scores.length);

  return {
    text: word.text.trim(),
    from: word.from,
    to: word.to,
    dtw: word.dtw,
    confidence: Number(confidence.toFixed(4)),
  };
}

function extend(word: Building, token: WhisperToken, text: string): void {
  word.text += text;
  word.to = seconds(token.offsets?.to);

  if (typeof token.p === 'number') word.scores.push(token.p);

  if (typeof token.t_dtw === 'number' && token.t_dtw >= 0 && !PUNCTUATION.test(text)) word.dtw = token.t_dtw / 100;
}

function tokenWords(tokens: readonly WhisperToken[]): RawWord[] {
  const words: RawWord[] = [];
  let current: Building | null = null;

  for (const token of tokens) {
    const text = typeof token.text === 'string' ? token.text : '';

    if (!text || SPECIAL.test(text.trim())) continue;

    if (current === null || text.startsWith(' ')) {
      if (current?.text.trim()) words.push(finish(current));

      current = { text: '', from: seconds(token.offsets?.from), to: 0, dtw: null, scores: [] };
    }

    extend(current, token, text);
  }

  if (current?.text.trim()) words.push(finish(current));

  return words;
}

/** The language and raw words of a whisper.cpp JSON transcript. Throws on anything else. */
export function parseWhisperJson(json: unknown): { language?: string; words: RawWord[] } {
  const data = json as WhisperJson | null;

  if (!data || !Array.isArray(data.transcription)) {
    throw new Error('not a whisper.cpp JSON transcript (no "transcription" array)');
  }

  const words = data.transcription.flatMap((segment) => tokenWords(segment.tokens ?? []));
  const language = typeof data.result?.language === 'string' ? data.result.language : undefined;

  return { ...(language === undefined ? {} : { language }), words };
}
