// Shot boundaries, from three readings of the sampled luma:
// - dips: runs of black frames inside the clip (a fade out, a black hold, a fade in) are one boundary each;
// - cuts: the reference-style cut detector (neighbourhood ratio test, so a pan reads as motion), each
//   classified as a cut, or a dissolve when the change is spread over neighbouring frames; a one-sample
//   flash between matching frames is not a cut;
// - slow dissolves: a cross-fade too even for the ratio test, found where a frame is the average of the
//   frames half a second either side of it while those two differ (a pan or a cut never is).

import { detectCuts, frameDifference, frameDifferences } from '../style/pacing';
import { lumaOf } from '../style/texture';
import type { StyleFrame } from '../style/types';
import type { Boundary, TransitionGuess } from './types';

/** Sampling interval when frames carry no time: the reference samplers' 0.25 s. */
export const DEFAULT_FRAME_INTERVAL = 0.25;
// A frame reads as black under this mean 8-bit luma and this standard deviation (a dark scene with any
// detail — a night sky, a dark interface — is not black).
const DIP_LUMA = 12;
const DIP_SPREAD = 6;
// A neighbour difference at least this share of the peak means the change is spread over frames.
const RAMP_SHARE = 0.35;
// Cuts at most this many differences apart, with the frames between them still changing, are one change
// spread over frames (a dissolve's ramp). A still frame between them means a short shot: two boundaries.
const GROUP_GAP = 2;
// A flash: one sample unlike the frames either side of it, which match each other within this share of
// the jump (a light flash, a glitch) — motion inside a shot, not two cuts.
const FLASH_MATCH = 0.3;
// Slow dissolves: samples either side of the middle frame, the change between those two frames, and how
// far the middle frame may stray from their average (share of that change).
const DISSOLVE_SPAN = 2;
const DISSOLVE_MIN_CHANGE = 0.1;
const DISSOLVE_LINEARITY = 0.25;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function frameTime(frames: readonly StyleFrame[], k: number): number {
  return frames[k]?.time ?? k * DEFAULT_FRAME_INTERVAL;
}

function isBlack(luma: Uint8Array): boolean {
  if (luma.length === 0) return true;

  let sum = 0;
  let squares = 0;

  for (const value of luma) {
    sum += value;
    squares += value * value;
  }

  const mean = sum / luma.length;

  return mean < DIP_LUMA && Math.sqrt(Math.max(0, squares / luma.length - mean * mean)) < DIP_SPREAD;
}

/** Runs of black frames as [first, last] frame indices, edge runs (a fade in or out of the clip) included. */
function blackRuns(black: readonly boolean[]): [number, number][] {
  const runs: [number, number][] = [];

  for (const [k, isDark] of black.entries()) {
    if (!isDark) continue;

    const run = runs.at(-1);

    if (run?.[1] === k - 1) {
      run[1] = k;
      continue;
    }

    runs.push([k, k]);
  }

  return runs;
}

function nearBlack(black: readonly boolean[], from: number, to: number): boolean {
  return black.slice(Math.max(0, from - GROUP_GAP), to + GROUP_GAP + 1).some(Boolean);
}

function classify(diffs: readonly number[], i: number): TransitionGuess {
  const peak = diffs[i] ?? 0;
  const before = diffs[i - 1] ?? 0;
  const after = diffs[i + 1] ?? 0;

  return before >= RAMP_SHARE * peak && after >= RAMP_SHARE * peak ? 'dissolve' : 'cut';
}

function rampBetween(diffs: readonly number[], from: number, to: number): boolean {
  const peak = Math.max(diffs[from] ?? 0, diffs[to] ?? 0);

  return diffs.slice(from + 1, to).every((diff) => diff >= RAMP_SHARE * peak);
}

function groupCuts(cuts: readonly number[], diffs: readonly number[]): number[][] {
  const groups: number[][] = [];

  for (const cut of cuts) {
    const group = groups.at(-1);
    const previous = group?.at(-1);

    if (group && previous !== undefined && cut - previous <= GROUP_GAP && rampBetween(diffs, previous, cut)) {
      group.push(cut);
      continue;
    }

    groups.push([cut]);
  }

  return groups;
}

function isEvenBlend(lumas: readonly Uint8Array[], k: number): boolean {
  const before = lumas[k - DISSOLVE_SPAN];
  const after = lumas[k + DISSOLVE_SPAN];
  const middle = lumas[k];
  const change = frameDifference(before, after);

  if (change < DISSOLVE_MIN_CHANGE) return false;

  let residual = 0;

  for (let p = 0; p < middle.length; p++) residual += Math.abs(middle[p] - (before[p] + after[p]) / 2);

  return residual / middle.length / 255 <= DISSOLVE_LINEARITY * change;
}

function isFlash(lumas: readonly Uint8Array[], diffs: readonly number[], i: number): boolean {
  function matches(a: number, b: number): boolean {
    return a >= 0 && b < lumas.length && frameDifference(lumas[a], lumas[b]) < FLASH_MATCH * diffs[i];
  }

  return matches(i - 1, i + 1) || matches(i, i + 2);
}

/** Runs of frames that sit midway through an even cross-fade, as [first, last] frame indices. */
function blendRuns(lumas: readonly Uint8Array[], black: readonly boolean[]): [number, number][] {
  const runs: [number, number][] = [];

  for (let k = DISSOLVE_SPAN; k < lumas.length - DISSOLVE_SPAN; k++) {
    if (nearBlack(black, k - DISSOLVE_SPAN, k + DISSOLVE_SPAN) || !isEvenBlend(lumas, k)) continue;

    const run = runs.at(-1);

    if (run?.[1] === k - 1) {
      run[1] = k;
      continue;
    }

    runs.push([k, k]);
  }

  return runs;
}

/** The boundaries between shots, in time order. A dip's black frames and a dissolve's ramp are one boundary. */
export function findBoundaries(frames: readonly StyleFrame[]): Boundary[] {
  if (frames.length < 2) return [];

  const lumas = frames.map(lumaOf);
  const diffs = frameDifferences(frames);
  const black = lumas.map(isBlack);
  const last = frames.length - 1;
  const dips: Boundary[] = blackRuns(black)
    .filter(([first, end]) => first > 0 && end < last)
    .map(([first, end]) => ({
      index: first,
      time: round2((frameTime(frames, first) + frameTime(frames, end)) / 2),
      transition: 'dip',
    }));
  const cuts: Boundary[] = groupCuts(detectCuts(diffs), diffs)
    .filter((group) => !nearBlack(black, group[0], (group.at(-1) ?? group[0]) + 1))
    .filter((group) => group.length > 1 || !isFlash(lumas, diffs, group[0]))
    .map((group) => {
      const first = group[0];
      const end = group.at(-1) ?? first;

      return {
        index: first,
        time: round2((frameTime(frames, first) + frameTime(frames, end + 1)) / 2),
        transition: end > first ? 'dissolve' : classify(diffs, first),
      };
    });
  const blends: Boundary[] = blendRuns(lumas, black)
    .filter(([first, end]) => !cuts.some((cut) => cut.index >= first - GROUP_GAP - 1 && cut.index <= end + GROUP_GAP))
    .map(([first, end]) => ({
      index: Math.floor((first + end) / 2),
      time: round2((frameTime(frames, first) + frameTime(frames, end)) / 2),
      transition: 'dissolve',
    }));

  return [...dips, ...cuts, ...blends].sort((a, b) => a.time - b.time);
}
