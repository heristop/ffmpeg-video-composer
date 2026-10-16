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

// A frame painted by `paint(x, y)` (luma on every channel).
function painted(paint: (x: number, y: number) => number, time: number): StyleFrame {
  const data = new Uint8Array(W * H * 3);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) data.fill(paint(x, y), (y * W + x) * 3, (y * W + x) * 3 + 3);
  }

  return { data, width: W, height: H, time };
}

const shotA = (x: number, y: number) => (Math.floor(x / 4) % 2 === 0 ? 40 : 200) + (y % 3) * 5;
const shotB = (x: number, y: number) => (Math.floor(y / 3) % 2 === 0 ? 230 : 70) - (x % 5) * 4;

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

  it('reads a fade out, a black hold and a fade in as one dip at the hold', () => {
    const values = [180, 180, 180, 180, 120, 60, 0, 0, 0, 60, 120, 180, 180, 180, 180];
    const boundaries = findBoundaries(values.map((v, k) => flat(v, t(k))));

    expect(boundaries).toEqual([{ index: 6, time: 1.75, transition: 'dip' }]);
  });

  it('reads a dark but detailed shot as a shot, not as black', () => {
    const night = (k: number) => painted((x) => (x % 2 === 0 ? 0 : 22), t(k));
    const frames = [...[0, 1, 2, 3].map(night), ...[4, 5, 6, 7].map((k) => flat(200, t(k)))];

    expect(findBoundaries(frames).map((b) => b.transition)).toEqual(['cut']);
  });

  it('finds a slow, even cross-fade spread over six samples', () => {
    const blend = (a: number, k: number) =>
      painted((x, y) => Math.round((1 - a) * shotA(x, y) + a * shotB(x, y)), t(k));
    const frames = [
      ...[0, 1, 2, 3, 4, 5].map((k) => blend(0, k)),
      ...[1, 2, 3, 4, 5, 6].map((step) => blend(step / 7, 5 + step)),
      ...[12, 13, 14, 15, 16, 17].map((k) => blend(1, k)),
    ];
    const boundaries = findBoundaries(frames);

    expect(boundaries.map((b) => b.transition)).toEqual(['dissolve']);
    expect(Math.abs(boundaries[0].time - 2.125)).toBeLessThanOrEqual(0.25);
  });

  it('reads a one-sample flash inside a shot as part of the shot, not as two cuts', () => {
    const values = [100, 100, 100, 100, 240, 100, 100, 100, 100];

    expect(findBoundaries(values.map((v, k) => flat(v, t(k))))).toEqual([]);
  });

  it('reads a brightness ramp inside one shot as no boundary', () => {
    const values = [100, 100, 100, 100, 110, 120, 130, 140, 150, 160, 170, 180, 180, 180, 180, 180];

    expect(findBoundaries(values.map((v, k) => flat(v, t(k))))).toEqual([]);
  });

  it('reads an exposure ramp on a detailed shot as no boundary', () => {
    const lift = [0, 0, 0, 0, 10, 20, 30, 40, 50, 60, 70, 80, 80, 80, 80, 80];
    const frames = lift.map((offset, k) => painted((x, y) => Math.min(255, shotA(x, y) * 0.8 + offset), t(k)));

    expect(findBoundaries(frames)).toEqual([]);
  });

  it('reads a fade through near-uniform dark grey as one dip', () => {
    const values = [180, 180, 180, 180, 120, 60, 30, 30, 60, 120, 180, 180, 180, 180];
    const boundaries = findBoundaries(values.map((v, k) => flat(v, t(k))));

    expect(boundaries.map((b) => b.transition)).toEqual(['dip']);
  });

  it('ignores a fade in from black at the start and a fade out at the end', () => {
    const values = [0, 60, 120, 180, 180, 180, 180, 180, 180, 120, 60, 0];

    expect(findBoundaries(values.map((v, k) => flat(v, t(k))))).toEqual([]);
  });

  it('falls back to a 0.25 s interval when frames carry no time', () => {
    const frames = [flat(10, 0), { ...flat(10, 0), time: undefined }];

    expect(frameTime(frames, 3)).toBe(0.75);
  });
});
