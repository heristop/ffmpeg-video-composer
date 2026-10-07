// Subtitles → timed cues: where the copy comes from (authored cues, an SRT document or grouped word
// timings) and when each word is spoken (its own timing, the section's word timings that fall inside
// the cue, or the cue window shared by character count). Pure; times are section seconds with the
// track `offset` applied. Time references must already be resolved: a cue still holding one is skipped.

import type { Subtitles, WordTimingInput } from '../../schemas/subtitles.schemas';
import { DEFAULT_GROUP_RULES, evenWordTimings, groupWords, type GroupRules, type WordTiming } from './grouping';
import { parseSrt } from './srt';

export interface TimedCue {
  /** Display window, section seconds. */
  start: number;
  end: number;
  /** The drawn words, each with the window it is spoken in. */
  words: WordTiming[];
}

type ResolveText = (text: Record<string, string | undefined>) => string;

interface SourceCue {
  start: number;
  end: number;
  text: string;
  words?: readonly WordTimingInput[];
}

/** The grouping rules with the track's overrides. */
export function groupRules(subtitles: Pick<Subtitles, 'group'>): GroupRules {
  return { ...DEFAULT_GROUP_RULES, ...subtitles.group };
}

function shifted(words: readonly WordTimingInput[], offset: number): WordTiming[] {
  return words.map((word) => ({ text: word.text, start: word.start + offset, end: word.end + offset }));
}

function authoredCues(subtitles: Subtitles, resolveText: ResolveText): SourceCue[] {
  if (subtitles.srt !== undefined) {
    return parseSrt(subtitles.srt).cues.map((cue) => ({ ...cue, text: resolveText({ text: cue.text }) }));
  }

  return (subtitles.cues ?? []).flatMap((cue) => {
    if (typeof cue.at !== 'number' || typeof cue.end !== 'number') return [];

    const text = resolveText(typeof cue.text === 'string' ? { text: cue.text } : cue.text);

    return [{ start: cue.at, end: cue.end, text, words: cue.words }];
  });
}

// The section's words spoken inside a cue (by their midpoint, so a word straddling a boundary lands once).
function wordsWithin(words: readonly WordTiming[], start: number, end: number): WordTiming[] {
  return words.filter((word) => {
    const mid = (word.start + word.end) / 2;

    return mid >= start && mid < end;
  });
}

function cueWords(cue: SourceCue, subtitles: Subtitles, offset: number): WordTiming[] {
  const start = cue.start + offset;
  const end = cue.end + offset;

  if (subtitles.timing !== 'even') {
    const own = cue.words
      ? shifted(cue.words, offset)
      : wordsWithin(shifted(subtitles.words ?? [], offset), start, end);

    if (own.length > 0) return own;
  }

  return evenWordTimings(cue.text, start, end);
}

function fromWords(subtitles: Subtitles, offset: number): TimedCue[] {
  const words = shifted(subtitles.words ?? [], offset);
  const groups = groupWords(words, groupRules(subtitles));

  if (subtitles.timing !== 'even') return groups;

  return groups.map((group) => ({
    ...group,
    words: evenWordTimings(group.words.map((word) => word.text).join(' '), group.start, group.end),
  }));
}

/** Every cue of the track in time order, with spoken word windows. */
export function timedCues(subtitles: Subtitles, resolveText: ResolveText): TimedCue[] {
  const offset = subtitles.offset ?? 0;
  const cues =
    subtitles.cues !== undefined || subtitles.srt !== undefined
      ? authoredCues(subtitles, resolveText).map((cue) => ({
          start: cue.start + offset,
          end: cue.end + offset,
          words: cueWords(cue, subtitles, offset),
        }))
      : fromWords(subtitles, offset);

  return cues.filter((cue) => cue.words.length > 0 && cue.end > cue.start).sort((a, b) => a.start - b.start);
}

/**
 * Cues extended to at least `minDuration` on screen, and trimmed so none runs into the next (cues are
 * in time order). A cue already longer than the minimum keeps its end.
 */
export function holdCues<T extends { start: number; end: number }>(cues: readonly T[], minDuration: number): T[] {
  return cues.map((cue, i) => {
    const next = cues.at(i + 1);
    const held = Math.max(cue.end, cue.start + minDuration);

    return { ...cue, end: next === undefined ? held : Math.max(cue.start, Math.min(held, next.start)) };
  });
}
