import { describe, expect, it } from 'vitest';
import { findBoundaries, frameTime } from '@/core/structure/shots';
import type { StyleFrame } from '@/core/style';

const W = 40;
const H = 30;

function flat(value: number, time: number): StyleFrame {
  return { data: new Uint8Array(W * H * 3).fill(value), width: W, height: H, time };
}

// A frame with a bright square whose x moves: a pan, large differences everywhere.
function panFrame(x: number, time: number): StyleFrame {
  const data = new Uint8Array(W * H * 3).fill(40);

  for (let y = 5; y < 25; y++) {
    for (let dx = 0; dx < 12; dx++) {
      const o = (y * W + ((x + dx) % W)) * 3;
      data[o] = 230;
      data[o + 1] = 230;
      data[o + 2] = 230;
    }
  }

  return { data, width: W, height: H, time };
}

const t = (k: number) => k * 0.25;

describe('findBoundaries', () => {
  it('finds a hard cut between two steady shots', () => {
    const frames = [...[0, 1, 2, 3].map((k) => flat(60, t(k))), ...[4, 5, 6, 7].map((k) => flat(200, t(k)))];

    expect(findBoundaries(frames)).toEqual([{ index: 3, time: 0.88, transition: 'cut' }]);
  });

  it('reads a dip through black as one dip boundary', () => {
    const values = [180, 180, 180, 180, 4, 180, 180, 180];
    const boundaries = findBoundaries(values.map((v, k) => flat(v, t(k))));

    expect(boundaries.length).toBe(1);
    expect(boundaries[0].transition).toBe('dip');
  });

  it('reads a cross-fade ramp as a dissolve', () => {
    const values = [40, 40, 40, 40, 90, 140, 190, 200, 200, 200, 200];
    const boundaries = findBoundaries(values.map((v, k) => flat(v, t(k))));

    expect(boundaries.map((b) => b.transition)).toEqual(['dissolve']);
  });

  it('keeps a half-second shot between two cuts as its own shot', () => {
    const values = [20, 20, 20, 20, 235, 235, 120, 120, 120, 120];

    expect(findBoundaries(values.map((v, k) => flat(v, t(k)))).map((b) => b.transition)).toEqual(['cut', 'cut']);
  });

  it('reads a steady pan as motion, not as cuts', () => {
    const frames = Array.from({ length: 16 }, (_, k) => panFrame(k * 3, t(k)));

    expect(findBoundaries(frames)).toEqual([]);
  });

  it('falls back to a 0.25 s interval when frames carry no time', () => {
    const frames = [flat(10, 0), { ...flat(10, 0), time: undefined }];

    expect(frameTime(frames, 3)).toBe(0.75);
  });
});
