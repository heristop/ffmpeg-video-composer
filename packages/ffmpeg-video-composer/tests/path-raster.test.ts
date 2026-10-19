import { describe, expect, it } from 'vitest';
import { generatedImage } from '@/editor/presets/generated-images';
import {
  parseTraceUrl,
  traceFileName,
  traceImage,
  tracePng,
  traceUrl,
  type TraceSpec,
} from '@/editor/presets/path-raster';

// A horizontal line from (10, 20) to (90, 20) inside a 100×40 box at the frame origin.
const line: TraceSpec = {
  mode: 'cover',
  x: 0,
  y: 0,
  w: 100,
  h: 40,
  thickness: 6,
  caps: 'round',
  color: '9298fb',
  path: 'M10_20L90_20',
};

function alphaAt(spec: TraceSpec, x: number, y: number): number {
  const image = traceImage(spec);

  return image.data[(y * image.width + x) * image.channels + (image.channels === 4 ? 3 : 0)];
}

describe('path raster: trace: URLs', () => {
  it('round-trips a spec and is recognised as a generated image', () => {
    const url = traceUrl({ ...line, dash: [12, 8], lo: 0.25, hi: 0.75 });

    expect(url.startsWith('trace:')).toBe(true);
    expect(url).not.toMatch(/[\s{}]/);
    expect(parseTraceUrl(url)).toEqual({ ...line, dash: [12, 8], lo: 0.25, hi: 0.75 });
    expect(generatedImage(url)?.name).toBe(traceFileName(parseTraceUrl(url) as TraceSpec));
    expect(traceFileName(line)).toMatch(/^trace-cover-[0-9a-f]{8}\.png$/);
  });

  it('rejects malformed or oversized specs', () => {
    expect(parseTraceUrl('sprite:kind=disc,w=4,h=4')).toBeNull();
    expect(parseTraceUrl(traceUrl(line).replace('mode=cover', 'mode=paint'))).toBeNull();
    expect(parseTraceUrl(traceUrl({ ...line, w: 9000 }))).toBeNull();
    expect(parseTraceUrl(traceUrl(line).replace('M10_20L90_20', 'M10_20L90'))).toBeNull();
  });
});

describe('path raster: the stroke', () => {
  it('covers the stroke with an anti-aliased edge, colour on every pixel', () => {
    const image = traceImage(line);

    expect(image.channels).toBe(4);
    expect(alphaAt(line, 50, 19)).toBe(255);
    expect(alphaAt(line, 50, 20)).toBe(255);
    expect(alphaAt(line, 50, 22)).toBe(255);
    expect(alphaAt(line, 50, 23)).toBe(0);
    // Thickness 5: the pixel centred 2.5 px off the centre line is half covered.
    expect(alphaAt({ ...line, thickness: 5 }, 50, 22)).toBeGreaterThan(96);
    expect(alphaAt({ ...line, thickness: 5 }, 50, 22)).toBeLessThan(160);
    expect(alphaAt(line, 50, 26)).toBe(0);
    expect([...image.data.subarray(0, 3)]).toEqual([0x92, 0x98, 0xfb]);
  });

  it('round caps reach past the ends, butt caps stop at them', () => {
    expect(alphaAt(line, 8, 19)).toBe(255);
    expect(alphaAt({ ...line, caps: 'butt' }, 8, 19)).toBe(0);
    expect(alphaAt({ ...line, caps: 'butt' }, 11, 19)).toBe(255);
  });

  it('a full circle has no caps: its joint is seamless even with butt caps', () => {
    const ring: TraceSpec = { ...line, w: 120, h: 120, caps: 'butt', path: 'E60_60_40_40_-90_360' };

    // The joint at 12 o'clock (60, 20): the pixels either side of it are fully covered.
    expect(alphaAt(ring, 59, 19)).toBe(255);
    expect(alphaAt(ring, 60, 19)).toBe(255);
  });

  it('dashes alternate along the path', () => {
    const dashed = { ...line, dash: [10, 10] as [number, number] };

    expect(alphaAt(dashed, 15, 19)).toBe(255);
    expect(alphaAt(dashed, 25, 19)).toBe(0);
    expect(alphaAt(dashed, 35, 19)).toBe(255);
  });

  it('bakes a trim window into the cover (the held state of a partial draw)', () => {
    const half = { ...line, hi: 0.5 };

    expect(alphaAt(half, 40, 19)).toBe(255);
    expect(alphaAt(half, 60, 19)).toBe(0);
    expect(alphaAt({ ...line, lo: 0.5 }, 40, 19)).toBe(0);
    expect(alphaAt({ ...line, lo: 0.5 }, 60, 19)).toBe(255);
  });
});

describe('path raster: the arc-length code mask', () => {
  const code = { ...line, mode: 'code' as const };

  it('is grayscale: 0 off the stroke, 1..255 along its length', () => {
    const image = traceImage(code);

    expect(image.channels).toBe(1);
    expect(alphaAt(code, 50, 30)).toBe(0);
    expect(alphaAt(code, 9, 19)).toBe(1);
    expect(alphaAt(code, 90, 19)).toBe(255);
    expect(Math.abs(alphaAt(code, 50, 19) - 128)).toBeLessThanOrEqual(2);

    const row = Array.from({ length: 80 }, (_, i) => alphaAt(code, 10 + i, 19));
    expect(row.every((v, i) => i === 0 || v >= row[i - 1])).toBe(true);
  });

  it('is deterministic, byte for byte', () => {
    const circle = { ...code, w: 220, h: 220, path: 'E110_110_100_100_-90_360' };

    expect(tracePng(circle)).toEqual(tracePng(circle));
  });
});

describe('path raster: trace: work budget', () => {
  const head = 'trace:mode=cover,cap=round,x=0,y=0,w=1024,h=1024';

  it('refuses a thickness past what the path schema allows', () => {
    expect(parseTraceUrl(`${head},t=80,d=M0_0L100_100`)).not.toBeNull();
    expect(parseTraceUrl(`${head},t=81,d=M0_0L100_100`)).toBeNull();
    expect(parseTraceUrl(`${head},t=100000,d=M0_0L100_100`)).toBeNull();
  });

  it('refuses a path whose segments together cost too much to paint', () => {
    const d = 'M0_0' + 'L1000_0L0_0'.repeat(4);

    expect(parseTraceUrl(`${head},t=80,d=${d}`)).not.toBeNull();
    expect(parseTraceUrl(`${head},t=80,d=${'M0_0' + 'L1000_1000L0_0'.repeat(4000)}`)).toBeNull();
  });

  it('refuses points that are not finite', () => {
    expect(parseTraceUrl(`${head},t=6,d=M0_0W0_0_1_1_1e-310_0`)).toBeNull();
  });
});
