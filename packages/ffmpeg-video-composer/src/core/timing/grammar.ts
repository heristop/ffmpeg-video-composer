// The section-local time-reference grammar. A time field (a kinetic delay, a graphic's `at`, a camera hit,
// a keyframe `t`...) may name WHEN instead of computing it: `"title.end + 0.2"`, `"50%"`, `"end - 0.5"`,
// `"beat:12"`, `"bar:3"`, `"cue:drop - 0.1"`. References are parsed here and resolved to plain seconds at
// compile time (core/timing/resolve.ts), so lowering only ever sees numbers. Pure.

export type TimeBase =
  | { kind: 'element'; id: string; edge: 'start' | 'end' }
  | { kind: 'percent'; value: number }
  | { kind: 'end' }
  | { kind: 'beat'; index: number }
  | { kind: 'bar'; index: number }
  | { kind: 'cue'; name: string };

export type TimeRef = TimeBase & { offset: number };

/**
 * Element ids and cue names: a letter, then letters, digits and `_`, with single `-` joins before a
 * letter (`hero-title`, `line_2`). A `-` before a digit is always the offset operator: `"cue:drop-2"` is
 * the cue `drop` minus 2 s, never a cue called `drop-2`.
 */
export const TIME_NAME = /^[A-Za-z]\w*(?:-[A-Za-z]\w*)*$/;
export const TIME_NAME_MAX = 40;

const NUMBER = String.raw`\d+(?:\.\d+)?`;
const OFFSET = new RegExp(String.raw`^(.*?)\s*([+-])\s*(${NUMBER})$`);
const PERCENT = new RegExp(String.raw`^(${NUMBER})%$`);
const GRID = /^(beat|bar):([1-9]\d{0,5})$/;
const ELEMENT_EDGE = /^(.+)\.(start|end)$/;

export const TIME_REF_SYNTAX =
  '"<id>.start" | "<id>.end" | "<percent>%" | "end" | "beat:<n>" | "bar:<n>" | "cue:<name>", ' +
  'each with an optional "+ seconds" / "- seconds" offset';

function isName(text: string): boolean {
  return text.length <= TIME_NAME_MAX && TIME_NAME.test(text);
}

function gridBase(match: RegExpExecArray): TimeBase {
  const index = Number(match[2]);

  return match[1] === 'beat' ? { kind: 'beat', index } : { kind: 'bar', index };
}

function parseBase(text: string): TimeBase | null {
  if (text === 'end') return { kind: 'end' };

  const percent = PERCENT.exec(text);

  if (percent) return Number(percent[1]) <= 100 ? { kind: 'percent', value: Number(percent[1]) } : null;

  const grid = GRID.exec(text);

  if (grid) return gridBase(grid);

  if (text.startsWith('cue:')) return isName(text.slice(4)) ? { kind: 'cue', name: text.slice(4) } : null;

  const element = ELEMENT_EDGE.exec(text);

  return element && isName(element[1])
    ? { kind: 'element', id: element[1], edge: element[2] as 'start' | 'end' }
    : null;
}

/** The parsed reference, or null when the text is not a time reference (plain or relative seconds too). */
export function parseTimeRef(text: string): TimeRef | null {
  const trimmed = text.trim();
  const whole = parseBase(trimmed);

  if (whole) return { ...whole, offset: 0 };

  const split = OFFSET.exec(trimmed);

  if (!split || split[1] === '') return null;

  const base = parseBase(split[1]);
  const magnitude = Number(split[3]);

  return base ? { ...base, offset: split[2] === '-' ? -magnitude : magnitude } : null;
}

/** Why `text` is not a valid time reference, or null when it is. */
export function timeRefError(text: string): string | null {
  if (parseTimeRef(text)) return null;

  if (/^\d+(?:\.\d+)?%/.test(text.trim())) return `"${text}": a percentage of the section is 0%..100%`;

  return `"${text}" is not a time reference; use seconds or ${TIME_REF_SYNTAX}`;
}

/** The candidate closest to `name` (edit distance ≤ 3), for "did you mean" hints. */
export function nearestName(name: string, candidates: Iterable<string>): string | undefined {
  let best: { name: string; distance: number } | undefined;

  for (const candidate of candidates) {
    const distance = editDistance(name.toLowerCase(), candidate.toLowerCase());

    if (distance <= 3 && (!best || distance < best.distance)) best = { name: candidate, distance };
  }

  return best?.name;
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);

  for (let i = 1; i <= a.length; i++) {
    const row = [i];

    for (let j = 1; j <= b.length; j++) {
      row.push(Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
    }

    previous = row;
  }

  return previous[b.length];
}
