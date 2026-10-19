import { describe, expect, it } from 'vitest';
import type { Filter, FilterGraphChain } from '@/core/types';
import { GraphicSchema } from '@/schemas/graphics.schemas';
import { lowerPath, type PathRequest } from '@/editor/presets/path-draw';
import { lowerStroke } from '@/editor/presets/stroke-graphics';
import { parseTraceUrl } from '@/editor/presets/path-raster';
import { graphicTiming } from '@/editor/presets/graphics';
import { evaluateExpr } from '@/services/geometry/drawtext-expr';
import { flatten, pointAt, shapeCommands, traceOf } from '@/editor/presets/path-geometry';

type Inputs = Map<string, string>;

function request(
  graphic: Record<string, unknown>,
  options: { inputs?: Inputs; warnings?: string[]; at?: number; until?: number } = {}
) {
  const inputs = options.inputs ?? new Map();

  return {
    graphic: { type: 'path', ...graphic },
    at: options.at ?? 0.5,
    until: options.until,
    seed: 1,
    index: 0,
    section: { name: 's', type: 'color_background', options: { duration: 3 } },
    ctx: {
      duration: 3,
      scale: '640:360',
      fps: 10,
      isVideo: false,
      masks: {
        available: true,
        input: (key: string, source: { url: string }) => {
          inputs.set(key, source.url);

          return `input:${key}`;
        },
        color: (c: string) => c,
        warn: (message: string) => options.warnings?.push(message),
      },
    },
  } as unknown as PathRequest;
}

function chainsOf(filters: Filter[]): FilterGraphChain[] {
  expect(filters).toHaveLength(1);
  expect(filters[0].type).toBe('graph');

  return filters[0].graph as FilterGraphChain[];
}

const all = (chains: FilterGraphChain[]) => chains.flatMap((chain) => chain.filters);
const values = (chains: FilterGraphChain[], type: string) =>
  all(chains)
    .filter((f) => f.type === type)
    .map((f) => f.value);

// A 200 px line drawn in 3 frames at 10 fps, linear, held: the smallest case with every part.
const LINE = {
  points: [
    [100, 100],
    [300, 100],
  ],
  duration: 0.3,
  ease: 'linear',
  exit: 'none',
  color: '#ffffff',
  head: true,
};

describe('path graphic: schema', () => {
  const parse = (g: Record<string, unknown>) => GraphicSchema.safeParse({ type: 'path', ...g }).success;

  it('refuses a wave too short to encode', () => {
    const wave = (wavelength: number) => ({ type: 'wave', x: 0, y: 100, width: 300, amplitude: 20, wavelength });
    const result = GraphicSchema.safeParse({ type: 'path', shape: wave(0.0004) });

    expect(parse({ shape: wave(0.01) })).toBe(true);
    expect(parse({ shape: wave(0.009) })).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('wavelength must be at least 0.01');
  });

  it('accepts points, shapes and an SVG d', () => {
    expect(
      parse({
        points: [
          [0, 0],
          [10, 10],
        ],
        smooth: true,
        closed: true,
      })
    ).toBe(true);
    expect(parse({ shape: { type: 'circle', cx: 0.5, cy: 0.5, r: 0.2 }, target: 'frame' })).toBe(true);
    expect(parse({ shape: { type: 'arc', cx: 100, cy: 100, r: 50, sweep: 270 } })).toBe(true);
    expect(parse({ shape: { type: 'wave', x: 0, y: 100, width: 300, amplitude: 20, wavelength: 80 } })).toBe(true);
    expect(parse({ d: 'M0 0 C10 0 20 10 20 20 q5 5 10 0 Z', dash: [8, 6], head: { size: 12, color: '#f96f99' } })).toBe(
      true
    );
    expect(
      parse({
        points: [
          [0, 0],
          [1, 1],
        ],
        from: 1,
        to: 0,
        exit: 'retract',
        duration: 6,
      })
    ).toBe(true);
  });

  it('rejects no geometry, two geometries, unsupported SVG commands and out-of-range trims', () => {
    expect(parse({})).toBe(false);
    expect(
      parse({
        points: [
          [0, 0],
          [1, 1],
        ],
        d: 'M0 0 L1 1',
      })
    ).toBe(false);
    expect(parse({ d: 'M0 0 A10 10 0 0 1 20 20' })).toBe(false);
    expect(parse({ points: [[0, 0]] })).toBe(false);
    expect(
      parse({
        points: [
          [0, 0],
          [1, 1],
        ],
        to: 1.5,
      })
    ).toBe(false);
    expect(parse({ shape: { type: 'star', cx: 0, cy: 0, r: 1 } })).toBe(false);
    expect(
      parse({
        points: [
          [0, 0],
          [1, 1],
        ],
        duration: 12,
      })
    ).toBe(false);
  });

  it('has a footprint on the motion timeline', () => {
    const timing = graphicTiming(GraphicSchema.parse({ type: 'path', ...LINE }), { width: 640, height: 360, fps: 10 });

    expect(timing.duration).toBe(0.3);
    expect(timing.bbox).toEqual({ x: 97, y: 97, w: 206, h: 6 });
  });
});

describe('path graphic: lowering', () => {
  it('registers the stroke, its arc-length code and its held state as trace: images', () => {
    const inputs: Inputs = new Map();

    lowerPath(request(LINE, { inputs }));

    const cover = parseTraceUrl(inputs.get('gs0_cover') as string);
    const code = parseTraceUrl(inputs.get('gs0_code') as string);

    expect(cover).toEqual({
      mode: 'cover',
      x: 94,
      y: 94,
      w: 212,
      h: 12,
      thickness: 6,
      caps: 'round',
      color: 'ffffff',
      path: 'M100_100L300_100',
    });
    expect(code).toEqual({ ...cover, mode: 'code', color: undefined });
    // Fully drawn, the held still IS the cover: split from it, decoded once per frame.
    expect(inputs.has('gs0_hold')).toBe(false);
    expect(inputs.get('gs0_head')).toBe('sprite:kind=piece,w=14,h=14,c=ffffff,shape=disc');
  });

  it('reveals the stroke with one lutyuv threshold per frame, then holds it as a still', () => {
    const chains = chainsOf(lowerPath(request(LINE)));

    expect(chains[0]).toEqual({
      filters: [
        { type: 'format', value: 'yuv420p' },
        { type: 'split', value: '2' },
      ],
      outputs: ['gs0_m', 'gs0_r0'],
    });
    expect(values(chains, 'trim')).toEqual(['end=0.8']);
    expect(values(chains, 'crop')).toContain('212:12:94:94');
    expect(values(chains, 'lutyuv')).toEqual([
      "y='255*clip(86-val,0,1)':enable='lt(t,0.55)'",
      "y='255*clip(171-val,0,1)':enable='gte(t,0.55)*lt(t,0.65)'",
      "y='255*clip(256-val,0,1)':enable='gte(t,0.65)'",
    ]);
    expect(values(chains, 'overlay')).toEqual([
      '0:0',
      "94:94:eof_action=pass:enable='gte(t,0.5)*lt(t,0.8)'",
      "94:94:enable='gte(t,0.8)'",
      "x='if(lt(t,0.55),160,if(lt(t,0.65),226,293))':y='93':enable='gte(t,0.45)'",
    ]);
    expect(all(chains).filter((f) => f.type === 'alphamerge')).toHaveLength(1);
    // The last chain feeds the section (no output label).
    expect(chains.at(-1)?.outputs).toBeUndefined();
  });

  it('a long draw keeps every expression shallow, and the head follows the arc length frame by frame', () => {
    const shape = { type: 'wave', x: 40, y: 180, width: 560, amplitude: 60, wavelength: 140 } as const;
    const long = request({ ...LINE, points: undefined, shape, duration: 10, ease: 'linear' }, { at: 0 });

    (long.ctx as { fps: number }).fps = 60;
    (long.ctx as { duration: number }).duration = 12;

    const chains = chainsOf(lowerPath(long));
    const head = values(chains, 'overlay').at(-1) as string;
    const [, x, y, enable] = /^x='([^']*)':y='([^']*)':enable='([^']*)'$/.exec(head) ?? [];
    const traced = traceOf(flatten(shapeCommands(shape)));

    expect(enable).toBe('gte(t,-0.008333)');
    let [depth, deepest] = [0, 0];

    for (const c of x) {
      depth += c === '(' ? 1 : 0;
      depth -= c === ')' ? 1 : 0;
      deepest = Math.max(deepest, depth);
    }

    // 600 steps nest about log2(600) ≈ 10 ifs deep.
    expect(deepest).toBeLessThanOrEqual(12);

    for (const frame of [0, 59, 299, 599]) {
      const expected = pointAt(traced, (frame + 1) / 600);
      const t = frame / 60;

      expect(Math.abs((evaluateExpr(x, { t }) as number) + 7 - expected.x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs((evaluateExpr(y, { t }) as number) + 7 - expected.y)).toBeLessThanOrEqual(0.5);
    }
  });

  it('a partial draw holds a cover with the trim baked in, and a translucent colour scales its alpha', () => {
    const inputs: Inputs = new Map();
    const chains = chainsOf(lowerPath(request({ ...LINE, to: 0.75, color: '#ffffff@0.5' }, { inputs })));

    expect(parseTraceUrl(inputs.get('gs0_hold') as string)?.hi).toBe(0.75);
    expect(values(chains, 'colorchannelmixer')).toEqual(['aa=0.5', 'aa=0.5']);
  });

  it('retracts: the tail runs after the head through the exit, and the head fades', () => {
    const inputs: Inputs = new Map();
    const chains = chainsOf(lowerPath(request({ ...LINE, exit: 'retract' }, { inputs, until: 2 })));
    const luts = values(chains, 'lutyuv');

    expect(inputs.has('gs0_hold')).toBe(false);
    expect(values(chains, 'trim')).toEqual(['end=2']);
    expect(luts).toHaveLength(9);
    expect(luts[2]).toBe("y='255*clip(256-val,0,1)':enable='gte(t,0.65)*lt(t,1.35)'");
    expect(luts.at(-1)).toBe("y='255*clip(256-val,0,1)*clip(val-255,0,1)':enable='gte(t,1.85)'");
    expect(values(chains, 'overlay')[1]).toBe("94:94:eof_action=pass:enable='gte(t,0.5)*lt(t,2)'");
    expect(values(chains, 'fade')).toEqual(['t=out:st=1.4:d=0.6:alpha=1']);
  });

  it('fades out before `until` by default', () => {
    const chains = chainsOf(lowerPath(request({ ...LINE, exit: undefined }, { until: 2 })));

    expect(values(chains, 'fade')).toEqual(['t=out:st=1.7:d=0.3:alpha=1', 't=out:st=1.7:d=0.3:alpha=1']);
    expect(values(chains, 'overlay')[2]).toBe("94:94:enable='gte(t,0.8)*lt(t,2)'");
  });

  it('an `until` inside the draw cuts everything there, with no held still', () => {
    const inputs: Inputs = new Map();
    const chains = chainsOf(lowerPath(request(LINE, { inputs, until: 0.7 })));

    expect(inputs.has('gs0_hold')).toBe(false);
    expect(values(chains, 'split')).toEqual(['2']);
    expect(values(chains, 'trim')).toEqual(['end=0.7']);
    expect(values(chains, 'overlay').at(-1)).toBe("x='if(lt(t,0.55),160,226)':y='93':enable='gte(t,0.45)*lt(t,0.65)'");
  });

  it('a round-capped line without a head gets a cap riding its drawing end', () => {
    const inputs: Inputs = new Map();

    lowerPath(request({ ...LINE, head: undefined }, { inputs }));

    expect(inputs.get('gs0_cap')).toBe('sprite:kind=piece,w=6,h=6,c=ffffff,shape=disc');
    expect(inputs.has('gs0_head')).toBe(false);
  });

  it('drops the cap once the drawing end reaches the end of the path (no nub on a closed circle)', () => {
    const inputs: Inputs = new Map();
    const circle = { ...LINE, points: undefined, head: undefined, shape: { type: 'circle', cx: 320, cy: 180, r: 60 } };
    const chains = chainsOf(lowerPath(request(circle, { inputs })));

    // Frames 0 and 1 are partial; frame 2 reaches the end: the cap rides until then only.
    expect(values(chains, 'overlay').at(-1)).toMatch(/:enable='gte\(t,0\.45\)\*lt\(t,0\.65\)'$/);
    expect(chains.at(-1)?.outputs).toBeUndefined();
  });

  it('lands the last frame exactly on `to`, so the cap leaves even when the ease stops a hair short', () => {
    const circle = { ...LINE, points: undefined, head: undefined, ease: 'cubic-bezier(0.16, 1, 0.3, 1)' };
    const chains = chainsOf(lowerPath(request({ ...circle, shape: { type: 'circle', cx: 320, cy: 180, r: 60 } })));

    expect(values(chains, 'overlay').at(-1)).toMatch(/\*lt\(t,0\.65\)'$/);
    expect(values(chains, 'lutyuv').at(-1)).toBe("y='255*clip(256-val,0,1)':enable='gte(t,0.65)'");
  });

  it('the cap leaves at full draw even when its last position merges with the held one', () => {
    // Linear on a short line: the last two frames place the cap at the same pixel as the hold.
    const chains = chainsOf(
      lowerPath(
        request({
          ...LINE,
          head: undefined,
          points: [
            [100, 100],
            [101, 100],
          ],
        })
      )
    );

    expect(values(chains, 'overlay').at(-1)).toMatch(/enable='gte\(t,0\.45\)\*lt\(t,0\.65\)'$/);
  });

  it('a ring stopped short keeps round ends: a cap on the drawing end and a tail on the start of the loop', () => {
    const inputs: Inputs = new Map();
    const ring = {
      ...LINE,
      points: undefined,
      head: undefined,
      to: 0.75,
      shape: { type: 'circle', cx: 320, cy: 180, r: 60 },
    };
    const chains = chainsOf(lowerPath(request(ring, { inputs })));
    const overlays = values(chains, 'overlay');

    expect(inputs.has('gs0_tail')).toBe(true);
    expect(inputs.has('gs0_cap')).toBe(true);
    // Both ride to the cut: no closing edge, and never an Infinity in an expression.
    expect(overlays.slice(-2).every((o) => (o as string).endsWith("enable='gte(t,0.45)'"))).toBe(true);
    expect(JSON.stringify(chains)).not.toContain('Infinity');
    // The tail sits on the start, 12 o'clock: (320, 120) minus half the 6 px disc.
    expect(overlays.at(-2)).toMatch(/^x='317':y='117'/);
  });

  it('places target-relative coordinates inside the resolved target', () => {
    const inputs: Inputs = new Map();

    lowerPath(
      request(
        {
          ...LINE,
          points: [
            [0.25, 0.5],
            [0.75, 0.5],
          ],
          target: 'frame',
        },
        { inputs }
      )
    );

    expect(parseTraceUrl(inputs.get('gs0_cover') as string)?.path).toBe('M160_180L480_180');
  });

  it('is reached through the stroke dispatcher and is deterministic', () => {
    const a = JSON.stringify(
      lowerStroke(request({ ...LINE, shape: { type: 'circle', cx: 320, cy: 180, r: 80 }, points: undefined }))
    );
    const b = JSON.stringify(
      lowerStroke(request({ ...LINE, shape: { type: 'circle', cx: 320, cy: 180, r: 80 }, points: undefined }))
    );

    expect(a).toBe(b);
    expect(a).toContain('lutyuv');
  });

  it('warns and draws nothing when the segment cannot take its images or its target names nothing', () => {
    const warnings: string[] = [];
    const noInputs = request(LINE, { warnings });

    (noInputs.ctx.masks as { input: unknown }).input = () => null;
    expect(lowerPath(noInputs)).toEqual([]);
    expect(lowerPath(request({ ...LINE, target: 'layer:3' }, { warnings }))).toEqual([]);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/^\[path_inputs\] graphics\[0\] path:/);
    expect(warnings[1]).toMatch(/^\[path_target\]/);
  });
});
