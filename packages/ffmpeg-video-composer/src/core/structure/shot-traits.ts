// Per-shot traits from luma: the ground (mean luma), the anchor (the 3×3 cell with the most edge energy,
// where a headline or subject sits) and the motion (mean frame difference). Never what the detail is.

import { frameDifferences } from '../style/pacing';
import { lumaOf } from '../style/texture';
import type { StyleFrame } from '../style/types';
import type { Anchor, Ground } from './types';

const DARK = 0.35 * 255;
const LIGHT = 0.65 * 255;
// A cell must hold this many times its fair share (1/9) of the edge energy to anchor the shot.
const ANCHOR_LEAD = 1.6;
// Mean frame difference that reads as full motion (the reference-style analyzer's scale).
const FULL_MOTION_DIFF = 0.08;
const CELLS: Anchor[] = [
  'top-left',
  'top',
  'top-right',
  'left',
  'center',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
];

export function groundOf(frames: readonly StyleFrame[]): Ground {
  let sum = 0;
  let count = 0;

  for (const frame of frames) {
    for (const value of lumaOf(frame)) sum += value;
    count += frame.width * frame.height;
  }

  const mean = count === 0 ? 0 : sum / count;

  if (mean < DARK) return 'dark';

  if (mean > LIGHT) return 'light';

  return 'mid';
}

function cellEnergy(frame: StyleFrame): number[] {
  const luma = lumaOf(frame);
  const cells = new Array<number>(9).fill(0);
  const { width, height } = frame;

  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const p = y * width + x;
      const edge = Math.abs(luma[p] - luma[p + 1]) + Math.abs(luma[p] - luma[p + width]);
      const cell = Math.min(2, Math.floor((3 * y) / height)) * 3 + Math.min(2, Math.floor((3 * x) / width));
      cells[cell] += edge;
    }
  }

  return cells;
}

export function anchorOf(frames: readonly StyleFrame[]): Anchor {
  const totals = new Array<number>(9).fill(0);

  for (const frame of frames) cellEnergy(frame).forEach((energy, cell) => (totals[cell] += energy));

  const sum = totals.reduce((a, b) => a + b, 0);

  if (sum === 0) return 'spread';

  const best = totals.indexOf(Math.max(...totals));

  if (totals[best] / sum < ANCHOR_LEAD / 9) return 'spread';

  return CELLS[best];
}

export function motionOf(frames: readonly StyleFrame[]): number {
  const diffs = frameDifferences(frames);

  if (diffs.length === 0) return 0;

  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;

  return Math.round(Math.min(1, mean / FULL_MOTION_DIFF) * 100) / 100;
}
