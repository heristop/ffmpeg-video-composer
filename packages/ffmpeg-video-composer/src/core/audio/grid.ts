// The beat grid on top of a tempo estimate: comb alignment finds the phase (and polishes the period) that
// lands the most onset strength on the beats, a tracker walks the grid snapping each beat to the onset
// next to it, a least-squares fit of the snapped beats gives the final tempo and offset, and the downbeat
// is the bar position whose beats carry the strongest accents. Pure and deterministic.

import { sampleAt } from './tempo';

/** Phase resolution of the comb, in hops. */
const PHASE_STEP = 0.25;
/** Period search around the autocorrelation estimate: ±2 % in 40 steps. */
const PERIOD_SPAN = 0.02;
const PERIOD_STEPS = 40;
/** A beat snaps to the strongest onset within ±10 % of a period of its predicted time. */
const SNAP_WINDOW = 0.1;
/** Fewer snapped beats than this keep the comb period. */
const MIN_FIT_BEATS = 4;
/** A bar position wins the downbeat only when its accents beat the earlier ones by this share. */
const ACCENT_MARGIN = 1.1;

export interface Comb {
  /** Beat period, in hops. */
  period: number;
  /** First beat, in hops (0 ≤ phase < period). */
  phase: number;
}

function combScore(values: Float64Array, period: number, phase: number): number {
  let total = 0;

  for (let at = phase; at < values.length; at += period) total += sampleAt(values, at);

  return total;
}

function bestPhase(values: Float64Array, period: number): { phase: number; score: number } {
  let best = { phase: 0, score: -Infinity };

  for (let phase = 0; phase < period; phase += PHASE_STEP) {
    const score = combScore(values, period, phase);

    if (score > best.score) best = { phase, score };
  }

  return best;
}

/** The period (within ±2 % of `period`) and phase whose comb collects the most onset strength. */
export function alignComb(values: Float64Array, period: number): Comb {
  let best = { period, ...bestPhase(values, period) };

  for (let step = -PERIOD_STEPS / 2; step <= PERIOD_STEPS / 2; step++) {
    const candidate = period * (1 + (step / (PERIOD_STEPS / 2)) * PERIOD_SPAN);
    const found = bestPhase(values, candidate);

    if (found.score > best.score + 1e-12) best = { period: candidate, ...found };
  }

  return { period: best.period, phase: best.phase };
}

function strongest(values: Float64Array, from: number, to: number): number {
  let best = Math.max(0, Math.ceil(from));

  for (let index = best; index <= Math.min(values.length - 1, Math.floor(to)); index++) {
    if (values[index] > values[best]) best = index;
  }

  return best;
}

// Sub-hop peak position by parabolic interpolation.
function peakPosition(values: Float64Array, index: number): number {
  const left = values[index - 1] ?? values[index];
  const right = values[index + 1] ?? values[index];
  const curvature = left - 2 * values[index] + right;

  return curvature < 0 ? index + (0.5 * (left - right)) / curvature : index;
}

export interface TrackedBeat {
  /** Beat position, in hops. */
  at: number;
  /** Whether an onset above the threshold was found next to the prediction. */
  snapped: boolean;
}

/** Walks the comb across the envelope, snapping each beat to the onset next to its predicted time. */
export function trackBeats(values: Float64Array, threshold: Float64Array, comb: Comb): TrackedBeat[] {
  const beats: TrackedBeat[] = [];
  const reach = comb.period * SNAP_WINDOW;
  let predicted = comb.phase;

  // A hit right at the start sits within the snap window of a beat before the comb phase.
  while (predicted - comb.period >= -reach) predicted -= comb.period;

  while (predicted < values.length) {
    const index = strongest(values, predicted - reach, predicted + reach);
    const snapped = values[index] > threshold[index];
    const at = snapped ? peakPosition(values, index) : predicted;

    beats.push({ at, snapped });
    predicted = at + comb.period;
  }

  return beats;
}

/** Least-squares line through the snapped beats: period and position of beat 0, in hops. */
export function fitGrid(beats: readonly TrackedBeat[], comb: Comb): Comb {
  const points = beats.flatMap((beat, index) => (beat.snapped ? [[index, beat.at] as const] : []));

  if (points.length < MIN_FIT_BEATS) return comb;

  const meanX = points.reduce((sum, [x]) => sum + x, 0) / points.length;
  const meanY = points.reduce((sum, [, y]) => sum + y, 0) / points.length;
  const sxx = points.reduce((sum, [x]) => sum + (x - meanX) ** 2, 0);
  const sxy = points.reduce((sum, [x, y]) => sum + (x - meanX) * (y - meanY), 0);
  const period = sxx > 0 ? sxy / sxx : comb.period;

  return { period, phase: meanY - period * meanX };
}

/** Bar position (0-based beat index) of the first downbeat: the position with the strongest accents. */
export function downbeatIndex(accents: readonly number[], beatsPerBar: number): number {
  const totals = Array.from({ length: beatsPerBar }, () => ({ sum: 0, count: 0 }));

  for (const [index, accent] of accents.entries()) {
    totals[index % beatsPerBar].sum += accent;
    totals[index % beatsPerBar].count += 1;
  }

  const means = totals.map(({ sum, count }) => (count > 0 ? sum / count : 0));
  let best = 0;

  for (let position = 1; position < beatsPerBar; position++) {
    if (means[position] > means[best] * ACCENT_MARGIN) best = position;
  }

  return Math.min(best, Math.max(0, accents.length - 1));
}
