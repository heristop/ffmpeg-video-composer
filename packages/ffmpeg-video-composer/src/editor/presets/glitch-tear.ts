// Row tearing for the glitch graphic (`tear: <bands>`): the frame is cut into horizontal bands of seeded
// heights and each band is laid back over the frame shifted sideways by a seeded per-frame offset during
// the hit. One sub-graph: split into the base plus one copy per band, crop each band, overlay it at
// x = its offset for the frame (a sum of enable windows, evaluated once per frame) and y = its top.
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
/** Chance a band sits still on a given frame at full strength (it rises as the hit decays). */
const TEAR_REST = 0.25;

export interface TearBand {
  y: number;
  h: number;
  /** Offset per step (even px, signed; 0 = in place). */
  offsets: number[];
}

interface TearInput {
  bands: number;
  intensity: number;
  frame: Frame;
  seed: number;
  steps: Array<{ from: number; to: number; strength: number }>;
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

/** The bands and their per-step offsets (pure: the tests read it, the graph is built from it). */
export function tearBands(input: TearInput): TearBand[] {
  const random = seededRandom(fnv1a32(`${input.seed}:tear`));
  const bands = cuts(Math.min(MAX_TEAR_BANDS, input.bands), input.frame.height, random);
  const peak = input.frame.width * TEAR_SHIFT * input.intensity;

  return bands.map((band) => ({
    ...band,
    offsets: input.steps.map(({ strength }) => {
      const [still, amount] = [random(), random() * 2 - 1];

      // Even px: overlay snaps x to the chroma grid on yuv420p, so an odd offset would land a pixel off.
      return still < TEAR_REST + (1 - TEAR_REST) * (1 - strength) ? 0 : even(amount * peak * strength);
    }),
  }));
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
