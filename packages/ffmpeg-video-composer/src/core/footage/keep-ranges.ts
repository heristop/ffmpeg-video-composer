// Silence trimming for recorded clips: turn `silencedetect` spans into the source windows to KEEP. Pure
// and deterministic (millisecond-rounded), so the same analysis always lowers to the same trim/concat
// graph. The explicit `options.keep` form skips the analysis and goes through the same normalisation.

import type { KeepRange, TrimSilence } from '../types';

export interface SilenceSpan {
  start: number;
  /** null when the silence runs to the end of the file (silencedetect printed no silence_end). */
  end: number | null;
}

export interface TrimSilenceParams {
  edges: boolean;
  gaps: boolean;
  /** Shortest pause (seconds) that counts as silence; shorter speech gaps are never cut. */
  minSilence: number;
  /** Seconds of each silence kept next to the speech it borders. */
  margin: number;
  /** Silence threshold in dBFS. */
  threshold: number;
}

export const TRIM_SILENCE_DEFAULTS = { minSilence: 0.6, margin: 0.15, threshold: -35 } as const;
/** A kept piece shorter than this (a click, a breath between two cuts) is dropped. */
export const MIN_KEEP_SECONDS = 0.2;
// A silence starting/ending this close to the clip bounds is a leading/trailing edge, not a gap.
const EDGE_EPSILON = 0.05;

export function resolveTrimSilence(option: TrimSilence): TrimSilenceParams {
  return {
    edges: option.edges ?? true,
    gaps: option.gaps !== undefined,
    minSilence: option.gaps?.minSilence ?? TRIM_SILENCE_DEFAULTS.minSilence,
    margin: option.gaps?.margin ?? TRIM_SILENCE_DEFAULTS.margin,
    threshold: option.gaps?.threshold ?? TRIM_SILENCE_DEFAULTS.threshold,
  };
}

/** The `silencedetect` filter for these parameters (the analysis runs it once per clip). */
export function silencedetectFilter(params: Pick<TrimSilenceParams, 'threshold' | 'minSilence'>): string {
  return `silencedetect=noise=${params.threshold}dB:d=${params.minSilence}`;
}

/** Reads `silence_start: x` / `silence_end: y` pairs from silencedetect's stderr log. */
export function parseSilencedetect(log: string): SilenceSpan[] {
  const spans: SilenceSpan[] = [];

  for (const match of log.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    const at = Number(match[2]);
    const open = spans.at(-1);

    if (match[1] === 'start') spans.push({ start: Math.max(0, at), end: null });

    if (match[1] === 'end' && open?.end === null) open.end = at;
  }

  return spans;
}

function round(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

// The part of one silence to cut: everything for a leading/trailing edge except the margin next to the
// speech, the inside of a pause minus a margin on both sides. null when nothing is cut.
function cutOf(span: SilenceSpan, duration: number, params: TrimSilenceParams): KeepRange | null {
  const start = Math.min(Math.max(span.start, 0), duration);
  const end = Math.min(span.end ?? duration, duration);
  const leading = start <= EDGE_EPSILON;
  const trailing = end >= duration - EDGE_EPSILON;
  const enabled = leading || trailing ? params.edges : params.gaps;

  if (!enabled || end - start < params.minSilence - 1e-6) return null;

  const from = leading ? 0 : start + params.margin;
  const to = trailing ? duration : end - params.margin;

  return to - from > 0 ? [from, to] : null;
}

/** Complement of the cut windows inside [0, duration], walked with a monotone cursor. */
function complement(cuts: KeepRange[], duration: number): KeepRange[] {
  const keep: KeepRange[] = [];
  let cursor = 0;

  for (const [from, to] of cuts) {
    if (from > cursor) keep.push([cursor, from]);

    cursor = Math.max(cursor, to);
  }

  if (cursor < duration) keep.push([cursor, duration]);

  return keep;
}

/**
 * The windows of a `duration`-second clip to keep, given its silences. Pieces shorter than
 * MIN_KEEP_SECONDS are dropped; a clip that would lose everything (all silence) is kept whole.
 */
export function computeKeepRanges(spans: SilenceSpan[], duration: number, params: TrimSilenceParams): KeepRange[] {
  const cuts = [...spans]
    .sort((a, b) => a.start - b.start)
    .map((span) => cutOf(span, duration, params))
    .filter((cut): cut is KeepRange => cut !== null);
  const keep = complement(cuts, duration)
    .map(([from, to]): KeepRange => [round(from), round(to)])
    .filter(([from, to]) => to - from >= MIN_KEEP_SECONDS);

  return keep.length > 0 ? keep : [[0, round(duration)]];
}

/**
 * Normalises explicit keep ranges against the source length when it is known: each window clipped to
 * the clip, empty windows dropped. Validation already guarantees ascending, non-overlapping windows.
 */
export function clipKeepRanges(ranges: readonly KeepRange[], sourceDuration: number | null): KeepRange[] {
  const limit = sourceDuration ?? Number.POSITIVE_INFINITY;

  return ranges
    .map(([from, to]): KeepRange => [round(Math.max(0, from)), round(Math.min(to, limit))])
    .filter(([from, to]) => to > from);
}

export function keptDuration(ranges: readonly KeepRange[]): number {
  return round(ranges.reduce((sum, [from, to]) => sum + (to - from), 0));
}
