// Word timings (from speech-to-text, or authored) → caption groups: the phrases shown together.
//
// A new group starts before a word when any rule fires: a pause of at least `pause` seconds, the end
// of a sentence, a comma (or ; :) followed by at least `commaPause`, the group already holding
// `maxWords` words, or the word ending more than `maxSeconds` after the group's first word started.
// A group spoken in under `minSeconds` that was cut by a soft rule (not a sentence end or a pause)
// merges into its neighbour. Each group then enters `lead` seconds before its first word and lingers
// `linger` seconds after its last, but never into the next group: groups never overlap.

export interface WordTiming {
  text: string;
  /** Seconds in the section. */
  start: number;
  end: number;
}

export interface GroupRules {
  maxWords: number;
  maxSeconds: number;
  pause: number;
  commaPause: number;
  minSeconds: number;
  lead: number;
  linger: number;
}

export const DEFAULT_GROUP_RULES: GroupRules = {
  maxWords: 6,
  maxSeconds: 2.5,
  pause: 0.5,
  commaPause: 0.25,
  minSeconds: 0.5,
  lead: 0.08,
  linger: 0.6,
};

export interface CaptionGroup {
  words: WordTiming[];
  /** Display window, seconds in the section. */
  start: number;
  end: number;
}

const SENTENCE_END = /[.!?…。！？]["”’)\]]*$/;
const CLAUSE_END = /[,;:，、]["”’)\]]*$/;

type Reason = 'hard' | 'soft' | null;

// Why a group must end before `word` — 'hard' for a sentence end or a pause, 'soft' for the size
// limits — or null to keep going.
function breakBefore(group: readonly WordTiming[], word: WordTiming, rules: GroupRules): Reason {
  const prev = group.at(-1);

  if (!prev) return null;

  const gap = word.start - prev.end;

  if (gap >= rules.pause || SENTENCE_END.test(prev.text)) return 'hard';

  if (CLAUSE_END.test(prev.text) && gap >= rules.commaPause) return 'hard';

  if (group.length >= rules.maxWords || word.end - group[0].start > rules.maxSeconds) return 'soft';

  return null;
}

interface Run {
  words: WordTiming[];
  /** How the run ended: what decides whether a short run may merge forward. */
  ended: Reason;
}

function runs(words: readonly WordTiming[], rules: GroupRules): Run[] {
  const out: Run[] = [];
  let current: Run = { words: [], ended: null };

  for (const word of words) {
    const reason = breakBefore(current.words, word, rules);

    if (reason) {
      current.ended = reason;
      out.push(current);
      current = { words: [], ended: null };
    }

    current.words.push(word);
  }

  if (current.words.length > 0) out.push(current);

  return out;
}

function span(words: readonly WordTiming[]): number {
  return (words.at(-1)?.end ?? 0) - (words[0]?.start ?? 0);
}

// A short run cut by a soft rule absorbs the run after it (the next phrase is still the same breath).
function mergeShort(list: Run[], rules: GroupRules): WordTiming[][] {
  const out: WordTiming[][] = [];

  for (let i = 0; i < list.length; i++) {
    const run = list[i];
    const next = list.at(i + 1);

    if (next && run.ended === 'soft' && span(run.words) < rules.minSeconds) {
      out.push([...run.words, ...next.words]);
      i++;

      continue;
    }

    out.push(run.words);
  }

  return out;
}

/** Display windows for consecutive groups: lead in, linger out, never overlapping. */
export function displayWindows(groups: readonly WordTiming[][], rules: GroupRules): CaptionGroup[] {
  const starts = groups.map((words, i) => {
    const previousEnd = i > 0 ? (groups[i - 1].at(-1)?.end ?? 0) : 0;

    return Math.max(0, previousEnd, words[0].start - rules.lead);
  });

  return groups.map((words, i) => {
    const last = words.at(-1) as WordTiming;
    const next = starts.at(i + 1);
    const linger = last.end + rules.linger;

    return { words, start: starts[i], end: next === undefined ? linger : Math.min(linger, next) };
  });
}

/** Caption groups for a run of word timings (in time order). */
export function groupWords(words: readonly WordTiming[], rules: GroupRules = DEFAULT_GROUP_RULES): CaptionGroup[] {
  const usable = words.filter((word) => word.text.trim() !== '');

  if (usable.length === 0) return [];

  return displayWindows(mergeShort(runs(usable, rules), rules), rules);
}

/**
 * Word timings for a cue that has none: the cue window shared by character count (a word's share is
 * its length plus one for the space), so long words hold longer, as they do when spoken.
 */
export function evenWordTimings(text: string, start: number, end: number): WordTiming[] {
  const words = text.split(/\s+/).filter(Boolean);
  const total = words.reduce((sum, word) => sum + word.length + 1, 0);
  const duration = Math.max(0, end - start);
  let cursor = start;

  return words.map((word) => {
    const length = (duration * (word.length + 1)) / total;
    const timing = { text: word, start: cursor, end: cursor + length };
    cursor += length;

    return timing;
  });
}
