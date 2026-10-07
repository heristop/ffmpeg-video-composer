import { describe, expect, it } from 'vitest';
import { RAIL_ANCHOR, railLeft } from './clappy-rail.logic';

const LANE = 600;
const SIZE = 64;

/** The point he stands on, in px along the lane. */
const standsAt = (progress: number): number => railLeft(progress, LANE, SIZE) + SIZE * RAIL_ANCHOR;

describe('railLeft', () => {
  it('stands him on the fill’s leading edge through the run', () => {
    for (const progress of [0, 0.05, 0.25, 0.5, 0.9]) {
      expect(standsAt(progress)).toBeCloseTo(progress * LANE);
    }
  });

  it('starts him on the line, his back half overhanging it rather than running ahead of an empty bar', () => {
    expect(railLeft(0, LANE, SIZE)).toBe(-SIZE / 2);
    expect(standsAt(0)).toBe(0);
  });

  it('pulls him up at the lane’s end so none of him overflows it', () => {
    expect(railLeft(1, LANE, SIZE)).toBe(LANE - SIZE);
    expect(railLeft(0.99, LANE, SIZE) + SIZE).toBeLessThanOrEqual(LANE);
  });

  it('never puts him ahead of the fill, nor past the lane, at any progress', () => {
    for (let step = 0; step <= 100; step += 1) {
      const progress = step / 100;

      expect(standsAt(progress)).toBeLessThanOrEqual(progress * LANE + 1e-9);
      expect(railLeft(progress, LANE, SIZE) + SIZE).toBeLessThanOrEqual(LANE);
    }
  });

  it('moves him steadily forward as the bar fills', () => {
    const lefts = Array.from({ length: 101 }, (_, step) => railLeft(step / 100, LANE, SIZE));

    for (let step = 1; step < lefts.length; step += 1) {
      expect(lefts[step]).toBeGreaterThanOrEqual(lefts[step - 1] ?? 0);
    }
  });

  it('clamps progress outside 0..1 to the ends', () => {
    expect(railLeft(-1, LANE, SIZE)).toBe(railLeft(0, LANE, SIZE));
    expect(railLeft(3, LANE, SIZE)).toBe(railLeft(1, LANE, SIZE));
  });

  it('keeps him on the line before the lane is measured', () => {
    expect(railLeft(0.5, 0, SIZE)).toBe(-SIZE / 2);
  });

  it('on a lane narrower than he is, overhangs the start no further than the line', () => {
    expect(railLeft(1, 40, SIZE)).toBe(40 - SIZE);
    expect(railLeft(1, 10, SIZE)).toBe(-SIZE / 2);
  });
});
