// The render track's scroll maths, pure so it unit-tests without a page: how far the scroll has taken the
// render, how far Clappy's legs have run, and which way he faces.
import { clamp01 } from '@/presentation/components/kinetic/gradient-meter.logic';

/** Where the track's top sits, as a share of the viewport's height, when the run starts and when it ends. */
const START = 0.85;
const END = 0.4;

/** The most of a stride one frame may take, so a fling blurs into a sprint instead of strobing the legs. */
const MAX_STRIDE_STEP = 0.1;

/** Under this many pixels a move is jitter, not a change of direction. */
const TURN_THRESHOLD = 0.5;

/** How far the render has come, 0..1: 0 while the track's top is below 85% of the viewport, 1 from 40%. */
export const trackProgress = (top: number, viewportHeight: number): number => {
  if (viewportHeight <= 0) return 0;

  return clamp01((START * viewportHeight - top) / ((START - END) * viewportHeight));
};

/** The run cycle after he covers `dx` px of ground either way: one stride per `strideLength`, capped per frame. */
export const advanceStride = (stride: number, dx: number, strideLength: number): number =>
  stride + Math.min(Math.abs(dx) / strideLength, MAX_STRIDE_STEP);

/** Which way he faces after moving `dx` px: the way he runs, or as before through a sub-pixel jitter. */
export const facingAfter = (facing: 1 | -1, dx: number): 1 | -1 => {
  if (dx > TURN_THRESHOLD) return 1;

  if (dx < -TURN_THRESHOLD) return -1;

  return facing;
};
