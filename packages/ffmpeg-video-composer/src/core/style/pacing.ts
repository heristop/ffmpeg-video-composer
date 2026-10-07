// Pacing and motion energy from a sampled frame sequence. A cut is a frame difference that is both
// large in absolute terms and several times its neighbourhood's typical difference (the neighbourhood
// ratio test), so a fast pan — large differences everywhere — reads as motion, not as a run of cuts.

import { lumaOf } from './texture';
import type { Pacing, StyleFrame } from './types';

const MIN_CUT_DIFF = 0.1;
const NEIGHBOUR_RATIO = 3;
const WINDOW = 4;
const BASELINE_FLOOR = 0.01;
// Mean non-cut difference that reads as full motion energy (1.0).
const FULL_MOTION_DIFF = 0.08;

/** Mean absolute luma difference between two frames of the same size, 0..1. */
export function frameDifference(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);

  if (n === 0) return 0;

  let sum = 0;

  for (let i = 0; i < n; i++) sum += Math.abs(a[i] - b[i]);

  return sum / n / 255;
}

/** `diffs[i]` is the difference between frame i and frame i+1. */
export function frameDifferences(frames: readonly StyleFrame[]): number[] {
  const lumas = frames.map(lumaOf);

  return lumas.slice(1).map((luma, i) => frameDifference(lumas[i], luma));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function neighbourhood(diffs: readonly number[], i: number): number[] {
  const out: number[] = [];

  for (let j = Math.max(0, i - WINDOW); j <= Math.min(diffs.length - 1, i + WINDOW); j++) {
    if (j !== i) out.push(diffs[j]);
  }

  return out;
}

/** Indices into `diffs` that are cuts. Adjacent detections collapse to the larger one. */
export function detectCuts(diffs: readonly number[]): number[] {
  const cuts: number[] = [];

  for (let i = 0; i < diffs.length; i++) {
    const baseline = Math.max(BASELINE_FLOOR, median(neighbourhood(diffs, i)));

    if (diffs[i] < MIN_CUT_DIFF || diffs[i] < NEIGHBOUR_RATIO * baseline) continue;

    const last = cuts.at(-1);

    if (last !== undefined && i - last <= 1) {
      if (diffs[i] > diffs[last]) cuts[cuts.length - 1] = i;
      continue;
    }
    cuts.push(i);
  }

  return cuts;
}

function timeOf(frames: readonly StyleFrame[], index: number, interval: number): number {
  return frames[index]?.time ?? index * interval;
}

function sampleInterval(frames: readonly StyleFrame[]): number {
  const first = frames.at(0)?.time;
  const last = frames.at(-1)?.time;

  if (first === undefined || last === undefined || frames.length < 2) return 0.25;

  return Math.max(1e-3, (last - first) / (frames.length - 1));
}

function round(value: number, digits = 2): number {
  const f = 10 ** digits;

  return Math.round(value * f) / f;
}

export interface ClipMotion {
  pacing: Pacing;
  /** Mean non-cut frame difference mapped to 0..1. */
  energy: number;
}

/** Cut rate, average shot length and motion energy of a sampled clip. */
export function analyzePacing(frames: readonly StyleFrame[], duration?: number): ClipMotion {
  const interval = sampleInterval(frames);
  const diffs = frameDifferences(frames);
  const cuts = detectCuts(diffs);
  const span = duration ?? Math.max(interval, frames.length * interval);
  const cutSet = new Set(cuts);
  const steady = diffs.filter((_, i) => !cutSet.has(i));
  const mean = steady.length > 0 ? steady.reduce((s, d) => s + d, 0) / steady.length : 0;

  return {
    pacing: {
      avgShot: round(span / (cuts.length + 1)),
      cutsPerMinute: round((cuts.length / span) * 60, 1),
      cuts: cuts.length,
      cutTimes: cuts.map((i) => round(timeOf(frames, i + 1, interval))),
    },
    energy: round(Math.min(1, mean / FULL_MOTION_DIFF)),
  };
}
