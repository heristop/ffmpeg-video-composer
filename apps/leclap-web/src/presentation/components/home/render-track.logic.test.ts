import { describe, expect, it } from 'vitest';
import { advanceStride, facingAfter, trackProgress } from './render-track.logic';

describe('trackProgress', () => {
  const vh = 1000;

  it('starts once the track rises to 85% of the viewport', () => {
    expect(trackProgress(900, vh)).toBe(0);
    expect(trackProgress(850, vh)).toBe(0);
  });

  it('finishes once it reaches 40%', () => {
    expect(trackProgress(400, vh)).toBe(1);
    expect(trackProgress(-200, vh)).toBe(1);
  });

  it('runs linearly in between', () => {
    expect(trackProgress(625, vh)).toBeCloseTo(0.5);
    expect(trackProgress(760, vh)).toBeCloseTo(0.2);
  });

  it('reads a missing viewport as the start line', () => {
    expect(trackProgress(100, 0)).toBe(0);
  });
});

describe('advanceStride', () => {
  it('takes one stride per stride length of ground, whichever way he runs', () => {
    expect(advanceStride(0, 4.4, 88)).toBeCloseTo(0.05);
    expect(advanceStride(1, -4.4, 88)).toBeCloseTo(1.05);

    const run = Array.from({ length: 20 }).reduce<number>((stride) => advanceStride(stride, 4.4, 88), 0);
    expect(run).toBeCloseTo(1);
  });

  it('caps a fling so the legs never strobe', () => {
    expect(advanceStride(0, 4000, 88)).toBeCloseTo(0.1);
  });

  it('holds still when he does not move', () => {
    expect(advanceStride(2.25, 0, 88)).toBe(2.25);
  });
});

describe('facingAfter', () => {
  it('turns to face the way he runs', () => {
    expect(facingAfter(1, -12)).toBe(-1);
    expect(facingAfter(-1, 12)).toBe(1);
  });

  it('keeps facing the same way through a sub-pixel jitter', () => {
    expect(facingAfter(-1, 0.2)).toBe(-1);
    expect(facingAfter(1, -0.2)).toBe(1);
  });
});
