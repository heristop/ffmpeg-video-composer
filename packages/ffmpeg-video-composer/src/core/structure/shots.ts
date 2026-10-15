// Shot boundaries: the reference-style cut detector (neighbourhood ratio test, so a pan reads as motion),
// then each boundary classified from the luma around it — a near-black side is a dip, raised differences
// on both sides of the peak a dissolve, anything else a cut.

import { detectCuts, frameDifferences } from '../style/pacing';
import { lumaOf } from '../style/texture';
import type { StyleFrame } from '../style/types';
import type { Boundary, TransitionGuess } from './types';

/** Sampling interval when frames carry no time: the reference samplers' 0.25 s. */
export const DEFAULT_FRAME_INTERVAL = 0.25;
// Mean 8-bit luma under which a frame reads as black.
const DIP_LUMA = 12;
// A neighbour difference at least this share of the peak means the change is spread over frames.
const RAMP_SHARE = 0.35;

const round2 = (value: number): number => Math.round(value * 100) / 100;

export function frameTime(frames: readonly StyleFrame[], k: number): number {
  return frames[k]?.time ?? k * DEFAULT_FRAME_INTERVAL;
}

function meanLuma(frame: StyleFrame): number {
  const luma = lumaOf(frame);

  if (luma.length === 0) return 0;

  let sum = 0;

  for (const value of luma) sum += value;

  return sum / luma.length;
}

function classify(diffs: readonly number[], means: readonly number[], i: number): TransitionGuess {
  if (Math.min(means[i] ?? 255, means[i + 1] ?? 255) < DIP_LUMA) return 'dip';

  const peak = diffs[i] ?? 0;
  const before = diffs[i - 1] ?? 0;
  const after = diffs[i + 1] ?? 0;

  if (before >= RAMP_SHARE * peak && after >= RAMP_SHARE * peak) return 'dissolve';

  return 'cut';
}

// Cuts at most this many differences apart, with the frames between them still changing, are one change
// spread over frames (a dissolve's ramp). A still frame between them means a short shot: two boundaries.
const GROUP_GAP = 2;

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

/** The boundaries between shots, in time order. A dip's black frames and a dissolve's ramp are one boundary. */
export function findBoundaries(frames: readonly StyleFrame[]): Boundary[] {
  if (frames.length < 2) return [];

  const diffs = frameDifferences(frames);
  const means = frames.map(meanLuma);

  return groupCuts(detectCuts(diffs), diffs).map((group) => {
    const first = group[0];
    const last = group.at(-1) ?? first;
    const black = means.slice(first, last + 2).some((mean) => mean < DIP_LUMA);
    const spread: TransitionGuess = black ? 'dip' : 'dissolve';

    return {
      index: first,
      time: round2((frameTime(frames, first) + frameTime(frames, last + 1)) / 2),
      transition: last > first ? spread : classify(diffs, means, first),
    };
  });
}
