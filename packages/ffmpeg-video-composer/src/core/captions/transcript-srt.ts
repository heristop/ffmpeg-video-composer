// Transcript words → an SRT document for `leclap transcribe --srt` and transcribe_media. Subtitle files are
// read, not flashed word by word like the render's karaoke phrases (core/captions/grouping.ts), so cues
// follow the speech: a cue ends at sentence punctuation, and at a clause mark or a pause of 0.3 s or more
// once it holds two words; it is capped at two lines of 42 characters and 7 seconds; a word left on its own
// joins a neighbour. Pure and deterministic.

import type { WordTiming } from './grouping';

export interface SrtRules {
  /** A silence this long (seconds) between two words ends a cue. */
  pause: number;
  /** Characters per line; a cue holds at most two lines. */
  lineChars: number;
  /** Longest cue, in seconds. */
  maxSeconds: number;
}

export const SRT_RULES: SrtRules = { pause: 0.3, lineChars: 42, maxSeconds: 7 };

const SENTENCE_END = /[.!?…]["'”’)\]]*$/;
const CLAUSE_END = /[,;:—–]["'”’)\]]*$/;

type Cue = WordTiming[];

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

function timestamp(seconds: number): string {
  const total = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor(total / 60_000) % 60;
  const secs = Math.floor(total / 1000) % 60;

  return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${pad(total % 1000, 3)}`;
}

function textOf(cue: Cue): string {
  return cue.map((word) => word.text).join(' ');
}

// Two lines, split at the word boundary that keeps the longer line shortest.
function lines(cue: Cue, rules: SrtRules): string[] {
  const text = textOf(cue);

  if (text.length <= rules.lineChars || cue.length < 2) return [text];

  let best = [text];
  let longest = Number.POSITIVE_INFINITY;

  for (let index = 1; index < cue.length; index++) {
    const split = [textOf(cue.slice(0, index)), textOf(cue.slice(index))];
    const length = Math.max(split[0].length, split[1].length);

    if (length < longest) {
      best = split;
      longest = length;
    }
  }

  return best;
}

function fits(cue: Cue, rules: SrtRules): boolean {
  const first = cue[0];
  const last = cue.at(-1) as WordTiming;

  return (
    last.end - first.start <= rules.maxSeconds && lines(cue, rules).every((line) => line.length <= rules.lineChars)
  );
}

// A cue ends after `word` at a sentence end, or at a clause mark or a pause once it holds two words.
function endsAfter(word: WordTiming, next: WordTiming | undefined, cue: Cue, rules: SrtRules): boolean {
  if (!next || SENTENCE_END.test(word.text)) return true;

  return cue.length > 1 && (CLAUSE_END.test(word.text) || next.start - word.end >= rules.pause);
}

function split(words: readonly WordTiming[], rules: SrtRules): Cue[] {
  const cues: Cue[] = [];
  let cue: Cue = [];

  for (const [index, word] of words.entries()) {
    if (cue.length > 0 && !fits([...cue, word], rules)) {
      cues.push(cue);
      cue = [];
    }

    cue.push(word);

    if (endsAfter(word, words[index + 1], cue, rules)) {
      cues.push(cue);
      cue = [];
    }
  }

  return cues;
}

// A one-word cue joins the previous cue when that one runs on (no sentence end), else the next, else the
// previous across the sentence end, as long as the joined cue still fits.
function joinLoneWords(cues: Cue[], rules: SrtRules): Cue[] {
  const joined: Cue[] = [];

  for (let index = 0; index < cues.length; index++) {
    const cue = cues[index];
    const previous = joined.at(-1);
    const next = cues.at(index + 1);

    if (cue.length !== 1) {
      joined.push(cue);
      continue;
    }

    const runsOn = previous !== undefined && !SENTENCE_END.test((previous.at(-1) as WordTiming).text);

    if (runsOn && fits([...previous, ...cue], rules)) {
      joined[joined.length - 1] = [...previous, ...cue];
      continue;
    }

    if (next && fits([...cue, ...next], rules)) {
      cues[index + 1] = [...cue, ...next];
      continue;
    }

    if (previous && fits([...previous, ...cue], rules)) {
      joined[joined.length - 1] = [...previous, ...cue];
      continue;
    }

    joined.push(cue);
  }

  return joined;
}

export function transcriptSrt(words: readonly WordTiming[], rules: SrtRules = SRT_RULES): string {
  const spoken = words.filter((word) => word.text.trim() !== '');

  return joinLoneWords(split(spoken, rules), rules)
    .map((cue, index) => {
      const start = cue[0].start;
      const end = Math.max(start, (cue.at(-1) as WordTiming).end);

      return `${index + 1}\n${timestamp(start)} --> ${timestamp(end)}\n${lines(cue, rules).join('\n')}\n`;
    })
    .join('\n');
}
