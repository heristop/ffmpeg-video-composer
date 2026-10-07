// Caption line breaking, measured with the bundled fonts' advance tables (synchronous, identical on
// every platform). Two strategies share one shape — words in, lines of words out:
//
// - greedy: fill each line until the next word would overflow (the fewest lines possible);
// - balanced: keep greedy's line count, then choose the break positions minimising, in order, a
//   readability penalty (a line ending on an article or preposition, a one-word orphan line), the
//   widest line, and the width difference between the widest and narrowest line.
//
// fitCaption shrinks the font until the copy fits `maxLines` lines no wider than `maxWidth`
// (fit-size-then-wrap), down to a floor; what still overflows is the caller's to split into consecutive cues.
//
// With an active scale above 1 (karaoke that draws the spoken word larger, centred on itself), a line is
// measured with the room that word needs: half its growth on each outer edge and, between two words, the
// larger of their half-growths on top of the space. A line laid out that way never lets the enlarged word
// touch its neighbours or the safe width, and doesn't move as the highlight travels.

import { measureBundled } from '../kinetic/layout';
import { isFunctionWord } from './function-words';

export type WrapMode = 'greedy' | 'balanced';

/** Break positions explored per balanced wrap before falling back to greedy (keeps long copy cheap). */
const BALANCE_BUDGET = 20_000;
/** Each shrink step multiplies the size by this factor. */
const SHRINK_STEP = 0.94;
const FALLBACK_GLYPH = 'n';

/**
 * Width of `text` in px with a bundled font, or null when the font isn't bundled. A character outside
 * the advance table (an em dash, an ellipsis) counts as an "n" so one rare glyph can't sink a layout.
 */
export function measureText(font: string, text: string, size: number): number | null {
  const whole = measureBundled(font, text, size);

  if (whole !== null) return whole;

  const fallback = measureBundled(font, FALLBACK_GLYPH, size);

  if (fallback === null) return null;

  let width = 0;

  for (const char of text) width += measureBundled(font, char, size) ?? fallback;

  return width;
}

/**
 * The extra room each word of a line needs on top of plain text so its `activeScale` version, centred
 * on the word, clears its neighbours: `edges[i]` before word i (after the previous one, or the line
 * start), and `edges[words.length]` after the last word. All zero at scale 1.
 */
export function activeReserve(font: string, words: readonly string[], size: number, activeScale: number): number[] {
  // Measured at the whole pixel size above the scaled one: word karaoke rounds it, pop peaks just under.
  const grown = Math.ceil(size * activeScale);
  const overhangs = words.map((word) =>
    activeScale > 1 ? ((measureText(font, word, grown) ?? 0) - (measureText(font, word, size) ?? 0)) / 2 : 0
  );

  return [...overhangs, 0].map((overhang, index) => Math.max(overhang, overhangs[index - 1] ?? 0));
}

type Measure = (words: readonly string[]) => number;

function measurer(font: string, size: number, activeScale: number): Measure | null {
  if (measureText(font, 'n', size) === null) return null;

  return (words) => {
    const text = measureText(font, words.join(' '), size) ?? 0;

    return activeScale > 1 ? text + activeReserve(font, words, size, activeScale).reduce((a, b) => a + b, 0) : text;
  };
}

function greedy(words: readonly string[], measure: Measure, maxWidth: number): string[][] {
  const lines: string[][] = [];
  let current: string[] = [];

  for (const word of words) {
    if (current.length > 0 && measure([...current, word]) > maxWidth) {
      lines.push(current);
      current = [];
    }

    current.push(word);
  }

  if (current.length > 0) lines.push(current);

  return lines;
}

interface Cost {
  penalty: number;
  widest: number;
  diff: number;
}

function linesCost(lines: readonly string[][], measure: Measure, total: number): Cost {
  const widths = lines.map((line) => measure(line));
  let penalty = 0;

  for (const [index, line] of lines.entries()) {
    if (index < lines.length - 1 && isFunctionWord(line.at(-1) ?? '')) penalty++;

    if (line.length === 1 && total > lines.length) penalty++;
  }

  return { penalty, widest: Math.max(...widths), diff: Math.max(...widths) - Math.min(...widths) };
}

function better(a: Cost, b: Cost): boolean {
  if (a.penalty !== b.penalty) return a.penalty < b.penalty;

  if (a.widest !== b.widest) return a.widest < b.widest;

  return a.diff < b.diff;
}

interface Search {
  words: readonly string[];
  measure: Measure;
  maxWidth: number;
  count: number;
  budget: number;
  best: { lines: string[][]; cost: Cost } | null;
}

// Depth-first over break positions; a line wider than maxWidth is pruned unless it is a single word.
function explore(search: Search, from: number, lines: string[][]): void {
  const { words, count } = search;
  const remaining = count - lines.length;

  if (--search.budget < 0) return;

  if (remaining === 1) {
    const last = words.slice(from);

    if (last.length > 1 && search.measure(last) > search.maxWidth) return;

    const candidate = [...lines, last];
    const cost = linesCost(candidate, search.measure, words.length);

    if (!search.best || better(cost, search.best.cost)) search.best = { lines: candidate, cost };

    return;
  }

  for (let end = from + 1; end <= words.length - remaining + 1; end++) {
    const line = words.slice(from, end);

    if (line.length > 1 && search.measure(line) > search.maxWidth) return;

    explore(search, end, [...lines, line]);
  }
}

function balanced(words: readonly string[], measure: Measure, maxWidth: number): string[][] {
  const fallback = greedy(words, measure, maxWidth);

  if (fallback.length < 2) return fallback;

  const search: Search = { words, measure, maxWidth, count: fallback.length, budget: BALANCE_BUDGET, best: null };
  explore(search, 0, []);

  return search.budget >= 0 && search.best ? search.best.lines : fallback;
}

/** Lines of words for `words` at `size`, or null when the font isn't bundled. */
export function wrapWords(
  words: readonly string[],
  font: string,
  size: number,
  maxWidth: number,
  mode: WrapMode = 'greedy'
): string[][] | null {
  const measure = measurer(font, size, 1);

  return measure && wrapMeasured(words, measure, maxWidth, mode);
}

function wrapMeasured(words: readonly string[], measure: Measure, maxWidth: number, mode: WrapMode): string[][] {
  return mode === 'balanced' ? balanced(words, measure, maxWidth) : greedy(words, measure, maxWidth);
}

/** Text lines (explicit "\n" always breaks), like kinetic's wrapLines but with a wrap mode. */
export function wrapText(text: string, font: string, size: number, maxWidth: number, mode: WrapMode): string[] | null {
  const lines: string[] = [];

  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    const wrapped = words.length === 0 ? [[]] : wrapWords(words, font, size, maxWidth, mode);

    if (!wrapped) return null;

    lines.push(...wrapped.map((line) => line.join(' ')));
  }

  return lines;
}

export interface FitInput {
  words: readonly string[];
  font: string;
  size: number;
  minSize: number;
  maxWidth: number;
  maxLines: number;
  mode: WrapMode;
  /** Size multiplier of the spoken word (karaoke), reserved around every word. Default 1. */
  activeScale?: number;
}

export interface Fit {
  size: number;
  lines: string[][];
  /** True when even `minSize` needs more than `maxLines` lines: split the cue. */
  overflow: boolean;
}

/** Candidate sizes, largest first: `size`, shrinking by SHRINK_STEP, ending exactly on `minSize`. */
export function shrinkSizes(size: number, minSize: number): number[] {
  const sizes = [size];
  let next = Math.round(size * SHRINK_STEP);

  while (next > minSize && next < (sizes.at(-1) ?? 0)) {
    sizes.push(next);
    next = Math.round(next * SHRINK_STEP);
  }

  if (minSize < size) sizes.push(minSize);

  return sizes;
}

/**
 * Shrink-then-wrap: the largest size whose wrap fits maxLines without a line (a lone long word, say)
 * wider than maxWidth, or null when the font isn't bundled. At the floor, the floor's wrap as is.
 */
export function fitCaption(input: FitInput): Fit | null {
  const sizes = shrinkSizes(input.size, Math.min(input.minSize, input.size));
  const activeScale = input.activeScale ?? 1;
  let last: Fit | null = null;

  for (const size of sizes) {
    const measure = measurer(input.font, size, activeScale);

    if (!measure) return null;

    const lines = wrapMeasured(input.words, measure, input.maxWidth, input.mode);

    last = { size, lines, overflow: lines.length > input.maxLines };

    if (!last.overflow && lines.every((line) => measure(line) <= input.maxWidth)) return last;
  }

  return last;
}
