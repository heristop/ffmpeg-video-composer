// packages/ffmpeg-video-composer/tests/mask-raster.test.ts
import { describe, expect, it } from 'vitest';
import {
  fillWork,
  maskCoverage,
  maskFileName,
  maskImage,
  maskPng,
  maskUrl,
  MAX_FILL_WORK,
  parseMaskUrl,
} from '@/editor/presets/mask-raster';
import { flattenWithin, MAX_ENCODED_PATH, MAX_MASK_PIXELS, pointBudget } from '@/editor/presets/mask-shape';
import { fnv1a32 } from '@/core/determinism/hash';
import { flatten, type PathCommand } from '@/editor/presets/path-geometry';
import { generatedImage } from '@/editor/presets/generated-images';

const SQUARE = { w: 20, h: 20, feather: 0, path: 'M2_2L18_2L18_18L2_18Z' };
const at = (data: Uint8Array, w: number, x: number, y: number) => data[y * w + x];

describe('mask images', () => {
  it('fills the shape white on black, crisp on whole pixels', () => {
    const { data, channels } = maskImage(SQUARE);

    expect(channels).toBe(1);
    expect(at(data, 20, 10, 10)).toBe(255);
    expect(at(data, 20, 2, 10)).toBe(255);
    expect(at(data, 20, 1, 10)).toBe(0);
    expect(at(data, 20, 0, 0)).toBe(0);
  });

  it('covers a half pixel by half', () => {
    expect(at(maskImage({ ...SQUARE, path: 'M2.5_2L18_2L18_18L2.5_18Z' }).data, 20, 2, 10)).toBe(128);
  });

  it('fills by the non-zero rule: an opposite inner loop is a hole, a same-way overlap is not doubled', () => {
    const hole = maskImage({ ...SQUARE, path: 'M2_2L18_2L18_18L2_18ZM6_6L6_14L14_14L14_6Z' }).data;
    const twice = maskImage({ ...SQUARE, path: 'M2_2L18_2L18_18L2_18ZM6_6L14_6L14_14L6_14Z' }).data;

    expect(at(hole, 20, 10, 10)).toBe(0);
    expect(at(hole, 20, 4, 10)).toBe(255);
    expect(at(twice, 20, 10, 10)).toBe(255);
  });

  it('feathers the edge symmetrically and keeps the core solid', () => {
    const { data } = maskImage({ w: 60, h: 60, feather: 10, path: 'M15_15L45_15L45_45L15_45Z' });

    expect(at(data, 60, 30, 30)).toBe(255);
    expect(at(data, 60, 15, 30)).toBeGreaterThan(100);
    expect(at(data, 60, 15, 30)).toBeLessThan(170);
    expect(at(data, 60, 3, 30)).toBeLessThan(3);
  });

  it('round-trips its URL, names its file deterministically and is a generated image', () => {
    const url = maskUrl(SQUARE);

    expect(url).toBe('mask:w=20,h=20,f=0,d=M2_2L18_2L18_18L2_18Z');
    expect(parseMaskUrl(url)).toEqual(SQUARE);
    expect(maskFileName(SQUARE)).toMatch(/^mask-[0-9a-f]{8}\.png$/);
    expect(maskPng(SQUARE)).toEqual(maskPng(SQUARE));
    expect(generatedImage(url)).toMatchObject({ label: 'Mask', name: maskFileName(SQUARE) });
  });

  it('refuses an oversized, unfeatherable or undecodable spec', () => {
    expect(parseMaskUrl('mask:w=5000,h=20,f=0,d=M2_2L18_2L18_18Z')).toBeNull();
    expect(parseMaskUrl('mask:w=20,h=20,f=-1,d=M2_2L18_2L18_18Z')).toBeNull();
    expect(parseMaskUrl('mask:w=20,h=20,f=0,d=M2_2L18')).toBeNull();
    expect(parseMaskUrl('trace:w=20')).toBeNull();
  });
});

const url = (parts: { w?: string; h?: string; f?: string; d?: string }) =>
  `mask:w=${parts.w ?? '20'},h=${parts.h ?? '20'},f=${parts.f ?? '0'},d=${parts.d ?? 'M2_2L18_2L18_18L2_18Z'}`;

describe('mask URLs from an untrusted author', () => {
  it('accepts only plain integer sizes within the side and pixel caps', () => {
    for (const w of ['', '0', '0x10', '1e1', '20.5', '020', '+20', '-20', ' 20', '4097']) {
      expect(parseMaskUrl(url({ w }))).toBeNull();
    }

    expect(parseMaskUrl(url({ h: '1e1' }))).toBeNull();
    expect(parseMaskUrl(url({ w: '4096', h: '4096' }))).toBeNull();
    expect(4096 * 4096).toBeGreaterThan(MAX_MASK_PIXELS);
    expect(parseMaskUrl(url({ w: '4096', h: '2048' }))).not.toBeNull();
  });

  it('accepts only a plain bounded decimal feather', () => {
    for (const f of ['', '0x5', '1e1', '.5', '5.', '-1', '201', 'Infinity', 'NaN', '1.2345', ' 5']) {
      expect(parseMaskUrl(url({ f }))).toBeNull();
    }

    expect(parseMaskUrl(url({ f: '200' }))?.feather).toBe(200);
    expect(parseMaskUrl(url({ f: '2.5' }))?.feather).toBe(2.5);
  });

  it('refuses extra, missing, reordered or trailing parts and stray characters', () => {
    expect(parseMaskUrl('mask:h=20,w=20,f=0,d=M2_2L18_2L18_18Z')).toBeNull();
    expect(parseMaskUrl(`${url({})},x=1`)).toBeNull();
    expect(parseMaskUrl(`${url({})}\n`)).toBeNull();
    expect(parseMaskUrl(url({ d: 'M2 2L18 2L18 18Z' }))).toBeNull();
    expect(parseMaskUrl(url({ d: '' }))).toBeNull();
    expect(parseMaskUrl(url({ d: 'M0x2_2L18_2L18_18Z' }))).toBeNull();
    expect(parseMaskUrl(url({ d: 'M2_2L1e1_2L18_18Z' }))).toBeNull();
    expect(parseMaskUrl(url({ d: 'M__L18_2L18_18Z' }))).toBeNull();
    expect(parseMaskUrl(url({ d: 'M2_2L_18L18_18Z' }))).toBeNull();
  });

  it('refuses an over-long path before decoding it, and a path with too many points', () => {
    expect(parseMaskUrl(url({ d: `M0_0${'L1_0L0_0'.repeat(9000)}Z` }))).toBeNull();
    expect(parseMaskUrl(url({ d: `M0_0${'Z'.repeat(70000)}` }))).toBeNull();
  });

  it('refuses a path with a non-finite point, a zero or denormal wavelength', () => {
    expect(parseMaskUrl(url({ d: 'M0_0W0_0_10_5_0_0Z' }))).toBeNull();
    expect(parseMaskUrl(url({ d: `M0_0W0_0_10_5_0.${'0'.repeat(309)}1_0Z` }))).toBeNull();
    expect(maskCoverage({ w: 20, h: 20, feather: 0, path: 'M0_0W0_0_10_5_0_0Z' })).toBeNull();
  });

  it('refuses a zig-zag wave that would take seconds to fill, without filling it', () => {
    const wave = 'M0_0W0_0_4000_2000_2_0L4000_4000L0_4000Z';

    expect(parseMaskUrl(url({ w: '4096', h: '4096'.replace('4096', '2048'), d: wave }))).toBeNull();
    expect(maskCoverage({ w: 4096, h: 2048, feather: 0, path: wave })).toBeNull();
  });

  it('refuses a spec over the fill work budget, counting each edge in sub-rows clipped to the raster', () => {
    const edge = { x0: 0, y0: -1000, x1: 1, y1: 3000, dir: 1 };

    expect(fillWork([edge], 40)).toBe(40);
    expect(fillWork([edge, edge], 40)).toBe(80);
    expect(fillWork([{ ...edge, y1: Number.NaN }], 40)).toBeNaN();
    expect(MAX_FILL_WORK).toBeLessThanOrEqual(20_000_000);
    expect(!(fillWork([{ ...edge, y1: Number.NaN }], 40) <= MAX_FILL_WORK)).toBe(true);
  });

  it('refuses to rasterise a spec whose size is out of bounds even when built directly', () => {
    expect(maskCoverage({ w: 5000, h: 20, feather: 0, path: 'M2_2L18_2L18_18Z' })).toBeNull();
    expect(() => maskImage({ w: 5000, h: 5000, feather: 0, path: 'M2_2L18_2L18_18Z' })).toThrow(RangeError);
  });

  it('shares one canonical URL and file between equal specs', () => {
    const a = parseMaskUrl(url({ f: '2.50' }));
    const b = parseMaskUrl(url({ f: '2.5' }));

    expect(a).toEqual(b);
    expect(a && maskUrl(a)).toBe(b && maskUrl(b));
    expect(a && maskFileName(a)).toBe(b && maskFileName(b));
    expect(generatedImage(url({ f: '2.50' }))?.name).toBe(generatedImage(url({ f: '2.5' }))?.name);
  });
});

describe('mask URLs that lie about their cost', () => {
  const SQUARE_D = 'M2_2L18_2L18_18L2_18Z';
  const bomb = `${SQUARE_D}M0_100000${'C9000_100000_9000_109000_0_109000'.repeat(1500)}ZM0_0W0_0_-100000000_0_10_0Z`;

  it('refuses a cubic flood hidden behind a negative-width wave', () => {
    expect(bomb.length).toBeLessThan(MAX_ENCODED_PATH);
    expect(parseMaskUrl(url({ d: bomb }))).toBeNull();
    expect(maskCoverage({ w: 20, h: 20, feather: 0, path: bomb })).toBeNull();
  });

  it('refuses negative or zero radii, widths and wavelengths outright', () => {
    for (const d of [
      'M0_0E10_10_-5_5_0_360Z',
      'M0_0E10_10_5_-5_0_360Z',
      'M0_0E10_10_0_5_0_360Z',
      'M0_0W0_0_-10_5_4_0Z',
      'M0_0W0_0_10_5_-4_0Z',
      'M0_0W0_0_0_5_4_0Z',
    ]) {
      expect(parseMaskUrl(url({ d }))).toBeNull();
    }
  });

  it('counts every point flatten would make, whatever the signs', () => {
    const cubics = (n: number) => ['M0_0', 'C9000_0_9000_9000_0_9000'.repeat(n), 'Z'].join('');

    expect(parseMaskUrl(url({ w: '4096', h: '2048', d: cubics(5) }))).toBeNull();
    expect(pointBudget([['M', 0, 0], ['C', 9000, 0, 9000, 9000, 0, 9000], ['Z']])).toBe(1 + 4096 + 1);
    expect(pointBudget([['E', 0, 0, -5, 5, 0, 360]])).toBeNaN();
    expect(pointBudget([['W', 0, 0, 10, 5, -4, 0]])).toBeNaN();
  });

  it('stops flattening once the point count passes the bound', () => {
    const many = Array.from({ length: 10 }, (): PathCommand[] => [
      ['M', 0, 0],
      ['C', 9000, 0, 9000, 9000, 0, 9000],
      ['Z'],
    ]).flat();

    expect(flattenWithin(many, 5000)).toBeNull();
    expect(flattenWithin(many, 100_000)).toEqual(flatten(many));
  });

  it('still renders a legitimate large mask', () => {
    const spec = { w: 4096, h: 2048, feather: 0, path: 'M100_100L4000_100L4000_2000L100_2000Z' };

    expect(parseMaskUrl(maskUrl(spec))).toEqual(spec);
    expect(maskImage(spec).data[1000 * 4096 + 2000]).toBe(255);
  });

  it('names the problem of a mask: URL that is not valid instead of letting it be fetched', () => {
    expect(() => generatedImage(url({ w: '0' }))).toThrow(/invalid mask URL: /);
    expect(() => generatedImage(url({ d: bomb }))).toThrow(/invalid mask URL: .*too/);
    expect(generatedImage('https://example.com/mask:x.png')).toBeNull();
  });
});

describe('mask cost bookkeeping', () => {
  it('counts the subpath start a line re-adds after every close', () => {
    const cycle: PathCommand[] = [['L', 1, 1], ['Z']];
    const commands: PathCommand[] = [['M', 0, 0], ...Array.from({ length: 5000 }, () => cycle).flat()];
    const made = flatten(commands).reduce((sum, points) => sum + points.length, 0);

    expect(pointBudget(commands)).toBeGreaterThanOrEqual(made);
  });

  it('keeps the same bytes through the buffer-reusing blur', () => {
    const { data } = maskImage({ w: 60, h: 50, feather: 10, path: 'M15_12L45_15L40_40L12_45Z' });

    expect(fnv1a32(Array.from(data).join(','))).toBe(2495834574);
  });

  it('caps the fill work at 4M crossings', () => {
    expect(MAX_FILL_WORK).toBe(4_000_000);
  });
});
