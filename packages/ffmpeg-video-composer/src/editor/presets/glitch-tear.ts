// Row tearing for the glitch graphic (`tear: <bands>`): the frame is cut into horizontal bands of seeded
// heights and each band is laid back over the frame shifted sideways during the hit. The tear comes in 2–3
// seeded bursts (strong) with the bands nearly still between them, and each band holds an offset for
// `hold` or `hold` + 1 frames before it jumps: a held displacement, not per-frame noise. One sub-graph:
// split into the base plus one copy per band, crop each band, overlay it at x = its offset for the frame
// (a sum of enable windows, evaluated once per frame) and y = its top.
// Filters used: split, crop, overlay (all in the on-device allowlist). Deterministic: its own seeded
// stream, so the RGB split and slices of an untorn glitch keep their exact values.

import type { Filter, FilterGraphChain } from '@/core/types';
import { fnv1a32, seededRandom } from '@/core/determinism/hash';
import { mergeRuns, windowExpr, type Frame } from './graphics-spec';

/**
 * Bands a tear may cut the frame into (the schema's bound). Each band is one split output (a reference, not
 * a copy), one crop and one band-sized overlay that is off outside the hit, so 24 bands stay cheap.
 */
export const MAX_TEAR_BANDS = 24;
/** Peak sideways shift at intensity 1, as a share of the frame width. */
const TEAR_SHIFT = 0.12;
/** Chance a band sits still through a hold at full strength (it rises as the amplitude falls). */
const TEAR_REST = 0.25;
/** Frames a band holds its offset by default (each hold is `hold` or `hold` + 1 frames, seeded). */
export const TEAR_HOLD = 2;
/** Amplitude between the bursts: nearly still, never quite frozen. */
const TEAR_QUIET = 0.08;

export interface TearBand {
  y: number;
  h: number;
  /** Offset per step (even px, signed; 0 = in place). */
  offsets: number[];
}

interface TearInput {
  bands: number;
  /** Frames each band holds its offset (at least). */
  hold: number;
  intensity: number;
  frame: Frame;
  seed: number;
  steps: Array<{ from: number; to: number }>;
}

interface Segment {
  length: number;
  strong: boolean;
}

function even(value: number): number {
  return 2 * Math.round(value / 2);
}

// Seeded band heights (weights 0.5–1.5), on even rows, covering the frame top to bottom.
function cuts(count: number, height: number, random: () => number): Array<{ y: number; h: number }> {
  const weights = Array.from({ length: count }, () => 0.5 + random());
  const total = weights.reduce((sum, w) => sum + w, 0);
  let acc = 0;
  const edges = [0, ...weights.map((w) => even(((acc += w) / total) * height))];

  edges[count] = height;

  return weights.map((_, i) => ({ y: edges[i], h: edges[i + 1] - edges[i] })).filter((band) => band.h >= 2);
}

// The next hold: `hold` or `hold` + 1 frames, never leaving a remainder shorter than a hold (it is split as
// hold + rest when both fit, else taken whole).
function holdLength(left: number, hold: number, random: () => number): number {
  if (left <= hold + 1) return left;

  const pick = hold + (random() < 0.5 ? 0 : 1);
  const rest = left - pick;

  if (rest >= hold) return pick;

  return left - hold >= hold ? left - hold : left;
}

// Lengths of `hold` or `hold` + 1 filling `total`, none shorter than `hold` (unless `total` itself is).
function holds(total: number, hold: number, random: () => number): number[] {
  const out: number[] = [];
  let left = total;

  while (left > 0) {
    const length = holdLength(left, hold, random);

    out.push(length);
    left -= length;
  }

  return out;
}

// Frames the bursts and the gaps between them need at least.
function roomOf(bursts: number[], hold: number): number {
  return bursts.reduce((sum, b) => sum + b, 0) + (bursts.length - 1) * hold;
}

// 2–3 bursts of `hold`..`hold` + 1 frames, as many as fit in `count` with a hold between them.
function burstLengths(count: number, hold: number, random: () => number): number[] {
  const wanted = random() < 0.5 ? 2 : 3;
  const bursts = Array.from({ length: wanted }, () => hold + (random() < 0.5 ? 0 : 1));

  while (bursts.length > 1 && roomOf(bursts, hold) > count) bursts.pop();

  return bursts;
}

// The bursts with their gaps between them, the last burst taking a tail shorter than a hold.
function interleave(bursts: number[], gaps: number[], last: number): Segment[] {
  return bursts.flatMap((length, i): Segment[] => {
    const burst = { length: length + (i === bursts.length - 1 ? last : 0), strong: true };

    return i < gaps.length ? [burst, { length: gaps[i], strong: false }] : [burst];
  });
}

// The window as quiet gaps and 2–3 strong bursts (each `hold`..`hold` + 1 frames), every segment at least
// `hold` long: [lead][burst][gap][burst]…[tail], interior gaps at least `hold`.
function segments(count: number, hold: number, random: () => number): Segment[] {
  const bursts = burstLengths(count, hold, random);
  const room = roomOf(bursts, hold);

  if (room >= count) return [{ length: count, strong: true }];

  const weights = Array.from({ length: bursts.length + 1 }, () => random());
  const total = weights.reduce((sum, w) => sum + w, 0) || 1;
  const extra = weights.map((w) => Math.floor(((count - room) * w) / total));
  const lead = extra[0] >= hold ? extra[0] : 0;
  const gaps = bursts.slice(1).map((_, i) => hold + extra[i + 1]);
  const tail = count - lead - room - extra.slice(1, -1).reduce((sum, e) => sum + e, 0);
  const last = tail > 0 && tail < hold ? tail : 0;
  const head: Segment[] = lead > 0 ? [{ length: lead, strong: false }] : [];
  const end: Segment[] = tail - last > 0 ? [{ length: tail - last, strong: false }] : [];

  return [...head, ...interleave(bursts, gaps, last), ...end];
}

/** The tear's amplitude per step, 0..1: 2–3 seeded bursts near 1, near 0 between them (pure, for the tests). */
export function tearEnvelope(count: number, hold: number, random: () => number): number[] {
  return segments(count, hold, random).flatMap(({ length, strong }) => {
    const amp = strong ? 0.75 + 0.25 * random() : TEAR_QUIET;

    return Array.from({ length }, () => amp);
  });
}

/** The bands and their per-step offsets (pure: the tests read it, the graph is built from it). */
export function tearBands(input: TearInput): TearBand[] {
  return tearPlan(input).bands;
}

// Runs of equal amplitude: a band's holds never straddle a burst's edge.
function runsOf(envelope: number[]): Array<{ amp: number; length: number }> {
  const runs: Array<{ amp: number; length: number }> = [];

  for (const amp of envelope) {
    const last = runs.at(-1);

    if (last?.amp === amp) {
      last.length++;
      continue;
    }

    runs.push({ amp, length: 1 });
  }

  return runs;
}

interface Shift {
  hold: number;
  peak: number;
  random: () => number;
}

// One band's offset per step: one seeded offset per hold, scaled by the run's amplitude.
function bandOffsets(runs: Array<{ amp: number; length: number }>, shift: Shift): number[] {
  return runs.flatMap(({ amp, length }) =>
    holds(length, shift.hold, shift.random).flatMap((frames) => {
      const [still, amount] = [shift.random(), shift.random() * 2 - 1];
      // Even px: overlay snaps x to the chroma grid on yuv420p, so an odd offset would land a pixel off.
      const offset = still < TEAR_REST + (1 - TEAR_REST) * (1 - amp) ? 0 : even(amount * shift.peak * amp);

      return Array.from({ length: frames }, () => offset);
    })
  );
}

/** The tear's per-step amplitude and its bands, from one seeded stream. */
export function tearPlan(input: TearInput): { envelope: number[]; bands: TearBand[] } {
  const random = seededRandom(fnv1a32(`${input.seed}:tear`));
  const bands = cuts(Math.min(MAX_TEAR_BANDS, input.bands), input.frame.height, random);
  const peak = input.frame.width * TEAR_SHIFT * input.intensity;
  const envelope = tearEnvelope(input.steps.length, input.hold, random);
  const runs = runsOf(envelope);

  return {
    envelope,
    bands: bands.map((band) => ({ ...band, offsets: bandOffsets(runs, { hold: input.hold, peak, random }) })),
  };
}

// Window bounds half a frame early: a step boundary lands mid-way between two frames, so the frame on it
// belongs to that step even after the bound is rounded to 4 decimals (1/30 s is not representable).
function early(seconds: number, fps: number): number {
  return Math.max(0, seconds - 0.5 / fps);
}

// x for one band: its offset in each run of equal offsets, 0 elsewhere (evaluated once per frame).
function shiftExpr(band: TearBand, steps: TearInput['steps'], fps: number): string {
  const runs = mergeRuns(
    steps.map((step, i) => ({
      from: early(step.from, fps),
      to: early(step.to, fps) as number | undefined,
      offset: band.offsets[i],
    })),
    (run) => String(run.offset)
  ).filter((run) => run.offset !== 0);

  return runs.map((run) => `${run.offset}*${windowExpr(run.from, run.to).slice(1, -1)}`).join('+');
}

/** The tear as one sub-graph filter, or none when no band ever moves. */
export function tearFilters(input: TearInput, prefix: string): Filter[] {
  const bands = tearBands(input).filter((band) => band.offsets.some((offset) => offset !== 0));

  if (bands.length === 0 || input.steps.length === 0) return [];

  const fps = input.frame.fps;
  const enable = windowExpr(early(input.steps[0].from, fps), early(input.steps.at(-1)?.to ?? 0, fps));
  const width = input.frame.width;
  const split: FilterGraphChain = {
    filters: [{ type: 'split', value: String(bands.length + 1) }],
    outputs: [`${prefix}base`, ...bands.map((_, i) => `${prefix}c${i}`)],
  };
  const crops = bands.map((band, i): FilterGraphChain => ({
    inputs: [`${prefix}c${i}`],
    filters: [{ type: 'crop', value: `${width}:${band.h}:0:${band.y}` }],
    outputs: [`${prefix}b${i}`],
  }));
  const overlays = bands.map((band, i): FilterGraphChain => ({
    inputs: [i === 0 ? `${prefix}base` : `${prefix}o${i - 1}`, `${prefix}b${i}`],
    filters: [{ type: 'overlay', value: `x='${shiftExpr(band, input.steps, fps)}':y=${band.y}:enable=${enable}` }],
    outputs: i === bands.length - 1 ? undefined : [`${prefix}o${i}`],
  }));

  return [{ type: 'graph', graph: [split, ...crops, ...overlays] }];
}
