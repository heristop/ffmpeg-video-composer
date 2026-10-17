import { describe, expect, it } from 'vitest';
import type { Pt } from '@/editor/presets/path-geometry';
import { fillCoverage } from '@/editor/presets/shape-fill';

const at = (cover: Float32Array, w: number, x: number, y: number) => cover[y * w + x];
const sum = (cover: Float32Array) => cover.reduce((total, value) => total + value, 0);
const square = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

// A five-point star drawn as one self-crossing loop (every second tip): its centre pentagon winds twice.
function pentagram(cx: number, cy: number, r: number): Pt[] {
  return Array.from({ length: 5 }, (_, k) => {
    const angle = ((-90 + k * 144) * Math.PI) / 180;

    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });
}

describe('fillCoverage', () => {
  it('covers whole pixels inside a pixel-aligned square and nothing outside', () => {
    const cover = fillCoverage([square(2, 2, 8, 8)], 10, 10, 'nonzero');

    expect(at(cover, 10, 5, 5)).toBe(1);
    expect(at(cover, 10, 2, 2)).toBe(1);
    expect(at(cover, 10, 1, 1)).toBe(0);
    expect(at(cover, 10, 8, 5)).toBe(0);
    expect(sum(cover)).toBe(36);
  });

  it('covers a pixel an edge splits in half by one half', () => {
    expect(at(fillCoverage([square(2.5, 2, 8, 8)], 10, 10, 'nonzero'), 10, 2, 5)).toBe(0.5);
  });

  it('measures a sloped edge exactly: a right triangle covers its area', () => {
    const cover = fillCoverage(
      [
        [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 0, y: 20 },
        ],
      ],
      20,
      20,
      'nonzero'
    );

    expect(sum(cover)).toBeCloseTo(200, 3);
  });

  it('closes an open subpath, as an SVG fill does', () => {
    const open = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];

    expect(sum(fillCoverage([open], 10, 10, 'nonzero'))).toBeCloseTo(50, 3);
  });

  it('fills a self-crossing star with nonzero and leaves its centre empty with evenodd', () => {
    const star = [pentagram(50, 50, 40)];

    expect(at(fillCoverage(star, 100, 100, 'nonzero'), 100, 50, 50)).toBe(1);
    expect(at(fillCoverage(star, 100, 100, 'evenodd'), 100, 50, 50)).toBe(0);
  });

  it('cuts a hole where an inner loop winds the other way (nonzero), and in evenodd whatever its direction', () => {
    const outer = square(2, 2, 18, 18);
    const reversed = square(6, 6, 14, 14).toReversed();
    const same = square(6, 6, 14, 14);

    expect(at(fillCoverage([outer, reversed], 20, 20, 'nonzero'), 20, 10, 10)).toBe(0);
    expect(at(fillCoverage([outer, reversed], 20, 20, 'nonzero'), 20, 3, 10)).toBe(1);
    expect(at(fillCoverage([outer, same], 20, 20, 'nonzero'), 20, 10, 10)).toBe(1);
    expect(at(fillCoverage([outer, same], 20, 20, 'evenodd'), 20, 10, 10)).toBe(0);
  });

  it('clips what lies outside the raster', () => {
    expect(sum(fillCoverage([square(-5, 0, 5, 10)], 10, 10, 'nonzero'))).toBe(50);
    expect(sum(fillCoverage([square(-50, -50, -10, -10)], 10, 10, 'nonzero'))).toBe(0);
  });
});
