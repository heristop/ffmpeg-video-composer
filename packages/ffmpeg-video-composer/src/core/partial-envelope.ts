// Elastic partials: a ref's `duration` re-times a partial without touching its motion design. The partial
// declares an envelope — IN (its first `in` seconds: entrances) and OUT (its last `out` seconds: exits) —
// and only the hold between them stretches.
//
// Partial time is the running sum of the partial's section durations (transitions inside the partial are
// not subtracted). With T the natural length, H = T - out the start of OUT and D the requested duration,
// every time point t of the partial maps to m(t):
//
//   D ≥ in + out, hold grows (extra = D - T ≥ 0):  m(t) = t            for t < H
//                                                  m(t) = t + extra    for t ≥ H
//   D ≥ in + out, hold shrinks (extra < 0):        IN kept, the hold scaled onto D - in - out, OUT shifted
//   D < in + out (partial_compressed):             IN and OUT scaled by D / (in + out), the hold removed
//
// Each section's new duration is m(end) - m(start), so the section containing H absorbs the extra hold
// and every other section keeps its length; every plain-seconds time field (kinetic delay/exit, graphic
// at/until, camera delay/hits/keys, drawtext reveal/exit/keys, assert visibleBy) and every cue is mapped
// through m in partial time, so elements in IN keep their absolute times and elements at or after H shift
// with the outro. Time references need nothing: "end - 0.5" follows the new end, "cue:x" the mapped cue.
// Raw FFmpeg expressions (enable=…, filter range) are not re-timed. Without an envelope the whole partial
// is IN (in = T, out = 0): a longer duration holds the tail, a shorter one compresses everything.
// Pure and deterministic.

import { secondsSlots } from './timing/fields';
import type { PartialEnvelope, SyncPoint } from '../schemas/partial.schemas';

type Bag = Record<string, unknown>;

export interface EnvelopeResult {
  sections: Bag[];
  /** True when the duration was shorter than IN + OUT. */
  compressed: boolean;
  /** Natural length of the partial. */
  natural: number;
  /** The partial-time map applied (identity-free callers map sync points through it). */
  map: (t: number) => number;
}

const EPSILON = 1e-6;

function round(value: number): number {
  return Number(value.toFixed(6));
}

function bag(value: unknown): Bag {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Bag) : {};
}

/** A section's fixed length, or undefined when only a probe knows it. */
export function fixedDuration(section: unknown): number | undefined {
  const node = bag(section);
  const duration = bag(node.options).duration;

  if (node.type === 'project_video' || typeof duration !== 'number' || duration <= 0) return undefined;

  return duration;
}

/**
 * Start of each section in partial time, plus the end of the last, for the leading run of sections whose
 * length is known (all of them when `complete`).
 */
export function partialStarts(sections: readonly unknown[]): { starts: number[]; complete: boolean } {
  const starts = [0];

  for (const section of sections) {
    const duration = fixedDuration(section);

    if (duration === undefined) return { starts, complete: false };
    starts.push((starts.at(-1) ?? 0) + duration);
  }

  return { starts, complete: true };
}

type TimeMap = (t: number) => number;

function growMap(hold: number, extra: number): TimeMap {
  return (t) => (t < hold - EPSILON ? t : t + extra);
}

function shrinkMap(envelope: PartialEnvelope, natural: number, target: number): TimeMap {
  const hold = natural - envelope.out;
  const ratio = (target - envelope.in - envelope.out) / (hold - envelope.in);

  return (t) => {
    if (t <= envelope.in) return t;

    return t < hold ? envelope.in + (t - envelope.in) * ratio : t + target - natural;
  };
}

function compressMap(envelope: PartialEnvelope, natural: number, target: number): TimeMap {
  const factor = target / (envelope.in + envelope.out);
  const hold = natural - envelope.out;

  return (t) => {
    if (t <= envelope.in) return t * factor;

    return t < hold ? envelope.in * factor : (envelope.in + t - hold) * factor;
  };
}

/** The time map of the module comment, and whether it compresses. */
export function envelopeTimeMap(
  envelope: PartialEnvelope,
  natural: number,
  target: number
): { map: TimeMap; compressed: boolean } {
  if (target < envelope.in + envelope.out - EPSILON) {
    return { map: compressMap(envelope, natural, target), compressed: true };
  }

  if (target >= natural) return { map: growMap(natural - envelope.out, target - natural), compressed: false };

  return { map: shrinkMap(envelope, natural, target), compressed: false };
}

function remapCues(cues: unknown, start: number, map: TimeMap): Bag | undefined {
  if (!cues || typeof cues !== 'object') return undefined;

  return Object.fromEntries(
    Object.entries(cues as Record<string, unknown>).map(([name, value]) => [
      name,
      typeof value === 'number' ? round(map(start + value) - map(start)) : value,
    ])
  );
}

function remapSection(section: unknown, start: number, end: number, map: TimeMap): Bag {
  const clone = structuredClone(bag(section));

  for (const slot of secondsSlots(clone)) slot.write(round(Math.max(0, map(start + slot.value) - map(start))));

  clone.options = { ...bag(clone.options), duration: round(map(end) - map(start)) };

  const cues = remapCues(clone.cues, start, map);

  if (cues) clone.cues = cues;

  return clone;
}

/**
 * The partial's sections re-timed to `target` seconds (module comment). Sections the compression reduces
 * to nothing (pure hold) are dropped. Requires every section length to be known: the caller checks.
 */
export function applyEnvelope(
  sections: readonly unknown[],
  starts: readonly number[],
  envelope: PartialEnvelope | undefined,
  target: number
): EnvelopeResult {
  const natural = starts.at(-1) ?? 0;
  const { map, compressed } = envelopeTimeMap(envelope ?? { in: natural, out: 0 }, natural, target);
  const out = sections
    .map((section, i) => remapSection(section, starts[i], starts[i + 1], map))
    .filter((section) => (bag(section.options).duration as number) > EPSILON);

  return { sections: out, compressed, natural, map };
}

/** Where a partial-time moment lands: the section index and its section-local offset. */
export function locate(starts: readonly number[], at: number): { index: number; offset: number } {
  const last = starts.length - 2;
  let index = 0;

  while (index < last && at >= starts[index + 1] - EPSILON) index++;

  return { index, offset: round(Math.max(0, at - starts[index])) };
}

/**
 * Exports every sync point as a cue (`cue:<id>`) on the section it falls in. An authored cue of the same
 * name wins. Sections are re-timed already; `starts` are their partial-time starts.
 */
export function exportSyncCues(sections: Bag[], starts: readonly number[], points: readonly SyncPoint[]): Bag[] {
  const out = sections.map((section) => ({ ...section }));

  for (const point of points) {
    // Past the sections of known length: the moment cannot be placed before rendering.
    if (starts.length < 2 || (starts.length <= sections.length && point.offset >= (starts.at(-1) ?? 0))) continue;

    const { index, offset } = locate(starts, point.offset);
    const section = out[index];
    const cues = bag(section.cues);

    if (!Object.hasOwn(cues, point.id)) section.cues = { ...cues, [point.id]: offset };
  }

  return out;
}
