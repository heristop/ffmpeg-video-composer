import { describe, expect, it } from 'vitest';
import { anchorOf, groundOf, motionOf } from '@/core/structure/shot-traits';
import type { StyleFrame } from '@/core/style';

const W = 60;
const H = 30;

// A ground with a striped (high-detail) patch in one third-by-third cell.
function withDetail(ground: number, cellX: number, cellY: number, time = 0): StyleFrame {
  const data = new Uint8Array(W * H * 3).fill(ground);

  for (let y = cellY * 10; y < cellY * 10 + 10; y++) {
    for (let x = cellX * 20; x < cellX * 20 + 20; x++) {
      const v = x % 2 === 0 ? 250 : 5;
      const o = (y * W + x) * 3;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
    }
  }

  return { data, width: W, height: H, time };
}

describe('shot traits', () => {
  it('reads the ground from mean luma', () => {
    expect(groundOf([withDetail(15, 0, 0)])).toBe('dark');
    expect(groundOf([withDetail(128, 1, 1)])).toBe('mid');
    expect(groundOf([withDetail(240, 2, 2)])).toBe('light');
  });

  it('anchors on the cell holding the detail', () => {
    expect(anchorOf([withDetail(20, 0, 0)])).toBe('top-left');
    expect(anchorOf([withDetail(20, 1, 1)])).toBe('center');
    expect(anchorOf([withDetail(20, 2, 2)])).toBe('bottom-right');
  });

  it('reads an evenly detailed frame as spread', () => {
    const data = new Uint8Array(W * H * 3);

    for (let p = 0; p < W * H; p++) data.fill(p % 2 === 0 ? 250 : 5, p * 3, p * 3 + 3);

    expect(anchorOf([{ data, width: W, height: H }])).toBe('spread');
  });

  it('scores motion 0 for a still shot and higher for a moving one', () => {
    const still = [0, 1, 2].map((k) => withDetail(20, 1, 1, k * 0.25));
    const moving = [0, 1, 2].map((k) => withDetail(20, k, 1, k * 0.25));

    expect(motionOf(still)).toBe(0);
    expect(motionOf(moving)).toBeGreaterThan(0.2);
    expect(motionOf(moving)).toBeLessThanOrEqual(1);
  });
});
