import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseGlyphOutlines } from '@/core/glyph-outline';
import { coverage, shapeOutline, type Point } from '@/core/motion/radial-matte';

// coverage() fills polygons with a scanline per sub-row. The reference below is the per-sample winding test
// it replaced (every edge for every one of the 4×4 samples of every pixel): the scanline must draw the same
// bytes, at a fraction of the cost.

const here = path.dirname(fileURLToPath(import.meta.url));
const archivo = new Uint8Array(
  fs.readFileSync(path.resolve(here, '../../leclap-creative-kit/src/library/fonts/ArchivoBlack.ttf'))
);

function insideRef(polygons: Point[][], x: number, y: number): boolean {
  let winding = 0;

  for (const polygon of polygons) {
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];

      if (a.y <= y && b.y > y && (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y) > 0) winding++;

      if (a.y > y && b.y <= y && (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y) < 0) winding--;
    }
  }

  return winding !== 0;
}

function coverageRef(polygons: Point[][], width: number, height: number): Uint8Array {
  const data = new Uint8Array(width * height);
  const points = polygons.flat();
  const [x0, x1] = [Math.min(...points.map((p) => p.x)), Math.max(...points.map((p) => p.x))];
  const [y0, y1] = [Math.min(...points.map((p) => p.y)), Math.max(...points.map((p) => p.y))];

  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(height, Math.ceil(y1) + 1); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(width, Math.ceil(x1) + 1); x++) {
      let hits = 0;

      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) hits += insideRef(polygons, x + (sx + 0.5) / 4, y + (sy + 0.5) / 4) ? 1 : 0;
      }
      data[y * width + x] = Math.round((255 * hits) / 16);
    }
  }

  return data;
}

function maxDiff(a: Uint8Array, b: Uint8Array): number {
  let max = 0;

  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i]));

  return max;
}

// The O of Archivo Black at 200 px, both rings (outer and counter), y down, in a 320 × 180 frame.
function glyphO(): Point[][] {
  const contours = parseGlyphOutlines(archivo)?.contours(0x4f) ?? [];

  return contours.map((ring) => ring.map((p) => ({ x: 100 + p.x * 0.2, y: 160 - p.y * 0.2 })));
}

describe('coverage: scanline fill', () => {
  const [W, H] = [320, 180];
  const cases: Array<[string, Point[][]]> = [
    ['circle', [shapeOutline('circle', { x: 150.3, y: 90.7 }, 70).polygon]],
    ['star', [shapeOutline('star', { x: 160, y: 80 }, 85).polygon]],
    ['heart', [shapeOutline('heart', { x: 120.25, y: 95.5 }, 60).polygon]],
    ['rounded-square', [shapeOutline('rounded-square', { x: 170, y: 90 }, 64).polygon]],
    ['heart past the frame', [shapeOutline('heart', { x: 300, y: 20 }, 120).polygon]],
    ['glyph O with its counter', glyphO()],
  ];

  for (const [name, polygons] of cases) {
    it(`draws the same bytes as the per-sample reference: ${name}`, () => {
      const image = coverage(polygons, W, H);

      expect(
        image.data.some((v) => v > 0),
        name
      ).toBe(true);
      expect(maxDiff(image.data, coverageRef(polygons, W, H)), name).toBeLessThanOrEqual(1);
    });
  }

  it('fills a 4000 px heart window over a full-HD frame in well under the old minute', () => {
    const heart = [shapeOutline('heart', { x: 960, y: 540 }, 2000).polygon];
    const start = performance.now();
    const image = coverage(heart, 1920, 1080);
    const elapsed = performance.now() - start;

    expect(image.data[540 * 1920 + 960]).toBe(255);
    expect(elapsed).toBeLessThan(2000);
  });
});
