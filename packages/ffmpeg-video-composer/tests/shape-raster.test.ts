import { describe, expect, it } from 'vitest';
import { generatedImage } from '@/editor/presets/generated-images';
import { parseTraceUrl } from '@/editor/presets/path-raster';
import { encodeCommands } from '@/editor/presets/path-svg';
import type { PathCommand } from '@/editor/presets/path-geometry';
import {
  MAX_ENCODED_PATH,
  MAX_SHAPE_PIXELS,
  MAX_FILL_WORK,
  MAX_SHAPE_POINTS,
  MAX_SHAPE_SIDE,
  parseShapeUrl,
  shapeFileName,
  shapeImage,
  shapePng,
  shapeUrl,
  type ShapeSpec,
} from '@/editor/presets/shape-raster';

const SQUARE: ShapeSpec = {
  w: 20,
  h: 20,
  rule: 'nonzero',
  fill: 'solid',
  c1: 'ff0000ff',
  sw: 0,
  path: 'M5_5L15_5L15_15L5_15Z',
};
const FULL = 'M0_0L20_0L20_20L0_20Z';

function px(spec: ShapeSpec, x: number, y: number): number[] {
  const image = shapeImage(spec);
  const i = (y * image.width + x) * 4;

  return Array.from(image.data.slice(i, i + 4));
}

function pentagram(): string {
  const points = Array.from({ length: 5 }, (_, k) => {
    const angle = ((-90 + k * 144) * Math.PI) / 180;

    return [50 + 40 * Math.cos(angle), 50 + 40 * Math.sin(angle)];
  });
  const commands: PathCommand[] = [
    ['M', points[0][0], points[0][1]],
    ...points.slice(1).map(([x, y]): PathCommand => ['L', x, y]),
    ['Z'],
  ];

  return encodeCommands(commands);
}

describe('shapeImage', () => {
  it('fills inside, and keeps the fill colour under transparent pixels so scaling never darkens the edge', () => {
    expect(px(SQUARE, 10, 10)).toEqual([255, 0, 0, 255]);
    expect(px(SQUARE, 1, 1)).toEqual([255, 0, 0, 0]);
  });

  it('anti-aliases a half-covered edge pixel and honours the colour alpha', () => {
    expect(px({ ...SQUARE, path: 'M5.5_5L15_5L15_15L5.5_15Z' }, 5, 10)).toEqual([255, 0, 0, 128]);
    expect(px({ ...SQUARE, c1: 'ff000080' }, 10, 10)).toEqual([255, 0, 0, 128]);
  });

  it('sweeps a linear gradient along its CSS angle (90: left to right)', () => {
    const spec: ShapeSpec = { ...SQUARE, fill: 'linear', c1: 'ff0000ff', c2: '0000ffff', angle: 90, path: FULL };
    const [left, right] = [px(spec, 0, 10), px(spec, 19, 10)];

    expect(left[0]).toBeGreaterThan(240);
    expect(left[2]).toBeLessThan(15);
    expect(right[0]).toBeLessThan(15);
    expect(right[2]).toBeGreaterThan(240);
  });

  it('runs a radial gradient from the centre out to the box edge', () => {
    const spec: ShapeSpec = { ...SQUARE, fill: 'radial', c1: 'ffffffff', c2: '000000ff', path: FULL };

    expect(px(spec, 10, 10)[0]).toBeGreaterThan(230);
    expect(px(spec, 0, 0).slice(0, 3)).toEqual([0, 0, 0]);
  });

  it('lays the outline over the fill', () => {
    const stroked: ShapeSpec = { ...SQUARE, sw: 2, sc: '00ff00ff' };

    expect(px(stroked, 5, 10)).toEqual([0, 255, 0, 255]);
    expect(px(stroked, 4, 10)).toEqual([0, 255, 0, 255]);
    expect(px(stroked, 10, 10)).toEqual([255, 0, 0, 255]);
    expect(px({ ...stroked, fill: 'none', c1: undefined }, 10, 10)[3]).toBe(0);
  });

  it('applies the fill rule', () => {
    const star: ShapeSpec = {
      w: 100,
      h: 100,
      rule: 'nonzero',
      fill: 'solid',
      c1: 'ffffffff',
      sw: 0,
      path: pentagram(),
    };

    expect(px(star, 50, 50)[3]).toBe(255);
    expect(px({ ...star, rule: 'evenodd' }, 50, 50)[3]).toBe(0);
  });

  it('is byte-for-byte deterministic', () => {
    expect(shapePng(SQUARE)).toEqual(shapePng({ ...SQUARE }));
  });
});

describe('work bounds', () => {
  const CURVES = 'M0_0C0_0_99999_0_0_99999'.repeat(2000);

  it('refuses an outline that flattens past the point budget, without flattening it all', () => {
    const spec: ShapeSpec = { ...SQUARE, w: 64, h: 64, path: CURVES };
    expect(MAX_SHAPE_POINTS).toBe(20_000);
    expect(() => shapeImage(spec)).toThrow(/points/);
    expect(parseShapeUrl(shapeUrl(spec))).toBeNull();
    expect(generatedImage(shapeUrl(spec))).toBeNull();
  });

  it('refuses a stroke whose pixel work exceeds the budget', () => {
    const lines = 'L2047_2047L0_2047L2047_0'.repeat(10);
    const spec: ShapeSpec = {
      ...SQUARE,
      w: 2048,
      h: 2048,
      fill: 'none',
      sw: 640,
      sc: '00ff00ff',
      path: `M0_0${lines}`,
    };

    expect(() => shapeImage(spec)).toThrow(/stroke/);
    expect(parseShapeUrl(shapeUrl(spec))).toBeNull();
  });

  it('paints a long diagonal stroke by its band, not its bounding box', () => {
    const spec: ShapeSpec = {
      ...SQUARE,
      w: 2048,
      h: 2048,
      fill: 'none',
      sw: 4,
      sc: '00ff00ff',
      path: 'M0_0L2047_2047',
    };

    expect(px(spec, 1000, 1000)[3]).toBe(255);
    expect(px(spec, 1000, 1100)[3]).toBe(0);
  });

  it('refuses a fill whose scanline work exceeds the budget', () => {
    const wave = 'W0_2048_1024_2048_2_90'.repeat(4);
    const spec: ShapeSpec = { ...SQUARE, w: 1024, h: 4096, path: wave };

    expect(MAX_FILL_WORK).toBe(20_000_000);
    expect(() => shapeImage(spec)).toThrow(/fill/);
    expect(parseShapeUrl(shapeUrl(spec))).toBeNull();
    expect(generatedImage(shapeUrl(spec))).toBeNull();
  });
});

describe('shapeImage raster bounds', () => {
  it.each([0, -1, 1.5, Number.NaN, MAX_SHAPE_SIDE + 1])('refuses a width of %s before allocating', (w) => {
    expect(() => shapeImage({ ...SQUARE, w })).toThrow(/size/);
  });

  it('refuses a raster over the pixel limit', () => {
    expect(() => shapeImage({ ...SQUARE, w: 4096, h: 2048 })).toThrow(/size/);
  });
});

describe('shape: URLs', () => {
  it('round-trips a spec, gradient and outline included', () => {
    const spec: ShapeSpec = {
      w: 40,
      h: 30,
      rule: 'evenodd',
      fill: 'linear',
      c1: '9298fbff',
      c2: 'f96f99d9',
      angle: 135,
      sw: 6,
      sc: 'f5f3f7ff',
      path: 'M2_2L38_2L20_28Z',
    };

    expect(shapeUrl(spec)).toBe(
      'shape:w=40,h=30,rule=evenodd,fill=linear,c1=9298fbff,c2=f96f99d9,a=135,sw=6,sc=f5f3f7ff,d=M2_2L38_2L20_28Z'
    );
    expect(parseShapeUrl(shapeUrl(spec))).toEqual(spec);
  });

  it('refuses oversized, malformed and foreign URLs before any pixel is allocated', () => {
    const url = (patch: Partial<ShapeSpec>) => shapeUrl({ ...SQUARE, ...patch });

    expect(parseShapeUrl(url({ w: 5000 }))).toBeNull();
    expect(parseShapeUrl(url({ w: 4096, h: 2048 }))).toBeNull();
    expect(4096 * 2048).toBeGreaterThan(MAX_SHAPE_PIXELS);
    expect(parseShapeUrl(url({ c1: 'red' }))).toBeNull();
    expect('L1_1'.repeat(20000).length).toBeGreaterThan(MAX_ENCODED_PATH);
    expect(MAX_ENCODED_PATH).toBe(65_536);
    expect(parseShapeUrl(url({ path: 'M5_5L15' }))).toBeNull();
    expect(parseShapeUrl(url({ sw: -1 }))).toBeNull();
    expect(parseShapeUrl(url({ path: `M0_0${'L1_1'.repeat(20000)}Z` }))).toBeNull();
    expect(parseShapeUrl(shapeUrl(SQUARE).replace('fill=solid', 'fill=pattern'))).toBeNull();
    expect(parseShapeUrl('panel:w=10,h=10')).toBeNull();
  });

  it('refuses an over-cap spec instead of rasterising it', () => {
    const over = shapeUrl({ ...SQUARE, path: `M0_0${'L1_1'.repeat(20000)}Z` });

    expect(generatedImage(over)).toBeNull();
    expect(generatedImage(shapeUrl({ ...SQUARE, w: MAX_SHAPE_SIDE + 1 }))).toBeNull();
  });

  it('refuses a path just over the encoded cap, whatever else is valid', () => {
    const over = `M0_0${'L1_1'.repeat(16_400)}`;
    const atCap = `M0_0${'L1_1'.repeat(16_383)}`;

    expect(over.length).toBeGreaterThan(MAX_ENCODED_PATH);
    expect(over.length).toBeLessThan(66_000);
    expect(atCap.length).toBe(MAX_ENCODED_PATH);
    expect(parseShapeUrl(shapeUrl({ ...SQUARE, path: over }))).toBeNull();
    expect(parseShapeUrl(shapeUrl({ ...SQUARE, path: atCap }))).not.toBeNull();
  });

  it('parses strictly and rounds to the cache key', () => {
    const url = shapeUrl(SQUARE);

    expect(parseShapeUrl(url.replace('w=20', 'w=0x10'))).toBeNull();
    expect(parseShapeUrl(url.replace('sw=0', 'sw='))).toBeNull();
    expect(parseShapeUrl(url.replace('sw=0', 'sw=1e2'))).toBeNull();
    expect(parseShapeUrl(url.replace(',sw=0', ',a=,sw=0'))).toBeNull();
    expect(parseShapeUrl(url.replace(',sw=0', ',a=361,sw=0'))).toBeNull();
    expect(parseShapeUrl(url.replace(',sw=0', ',a=-361,sw=0'))).toBeNull();
    expect(parseShapeUrl(url.replace('c1=ff0000ff,', ''))).toBeNull();
    expect(parseShapeUrl(url.replace('fill=solid', 'fill=linear'))).toBeNull();
    expect(parseShapeUrl(url.replace('fill=solid', 'fill=radial'))).toBeNull();
    expect(parseShapeUrl(url.replace('sw=0', 'sw=1.23456'))?.sw).toBe(1.235);
    expect(parseShapeUrl(url.replace(',sw=0', ',a=90.12345,sw=0'))?.angle).toBe(90.123);
  });

  it('is a generated image with a deterministic name', () => {
    const image = generatedImage(shapeUrl(SQUARE));

    expect(image?.label).toBe('Shape');
    expect(image?.name).toBe(shapeFileName(SQUARE));
    expect(image?.name).toMatch(/^shape-[0-9a-f]{8}\.png$/);
    expect(Array.from(image?.produce().slice(0, 4) ?? [])).toEqual([137, 80, 78, 71]);
  });
});

describe('shape work budgets fail closed', () => {
  function zigzag(prefix: string, h: number): string {
    let d = prefix + 'M0_0';

    for (let i = 0; d.length < MAX_ENCODED_PATH - 40; i++) d += `L${(i % 1000) + 1}_${i % 2 === 0 ? h : 0}`;

    return d + 'Z';
  }

  it('refuses a zero-wavelength poison prefix on a costly fill', () => {
    const url = (d: string) => `shape:w=1024,h=4096,rule=evenodd,fill=solid,c1=ff0000ff,sw=0,d=${d}`;

    expect(parseShapeUrl(url(zigzag('', 4096)))).toBeNull();
    expect(parseShapeUrl(url(zigzag('M0_0W0_0_1_1_0_0', 4096)))).toBeNull();
  });

  it('refuses a zero-wavelength poison prefix on a costly stroke', () => {
    const url = (d: string) => `shape:w=1024,h=4096,rule=nonzero,fill=none,sw=640,sc=ffffffff,d=${d}`;
    const t0 = performance.now();

    expect(parseShapeUrl(url(zigzag('M0_0W0_0_1_1_0_0', 4096)))).toBeNull();
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it('refuses a trace: URL with a zero wavelength', () => {
    expect(
      parseTraceUrl('trace:mode=cover,x=0,y=0,w=100,h=40,thickness=6,caps=round,color=9298fb,d=M0_0W0_0_10_5_0_0')
    ).toBeNull();
  });
});
