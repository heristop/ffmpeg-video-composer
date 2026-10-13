import { describe, expect, it } from 'vitest';
import type { Filter, FilterGraphChain, Section } from '@/core/types';
import { parseEasing } from '@/core/motion/easing';
import { easedProgressExpr } from '@/core/motion/hermite';
import { lowerFx, REGISTERED_FX } from '@/editor/presets/fx';
import { parseSpriteUrl, spriteImage } from '@/editor/presets/fx-sprites';
import type { SugarContext } from '@/editor/presets/sugar-context';
import { FX_PRIMITIVES, type FxGraphic } from '@/schemas/fx.schemas';
import { GraphicSchema } from '@/schemas/graphics.schemas';
import { DOT_SIZE, END, planOf } from '@/editor/presets/fx-burst';
import type { FxContext } from '@/editor/presets/fx-kit';

function burstContext(target: { x: number; y: number; w: number; h: number }): FxContext<'burst'> {
  return {
    graphic: { type: 'fx', effect: 'burst', jitter: 0 },
    target: { ...target, radius: 0, mask: 'none' },
    frame: { width: 1280, height: 720, fps: 30 },
    at: 0.4,
    duration: 0.6,
    passes: 1,
    every: 1.8,
    end: 1,
    ease: 'linear',
    color: '#FFFFFF',
    peak: 0.9,
    energy: 1,
    reduced: false,
    seed: 1,
    random: () => 0.5,
    prefix: 'fx0_',
    has: () => true,
    sprite: (key) => `input:${key}`,
  };
}

interface Options {
  energy?: number;
  has?: (filter: string) => boolean;
  seed?: number;
  theme?: unknown;
}

function lower(graphic: Partial<FxGraphic>, options: Options = {}) {
  const inputs: string[] = [];
  const warnings: string[] = [];
  const ctx: SugarContext = {
    duration: 4,
    scale: '1280:720',
    fps: 30,
    isVideo: false,
    theme: options.theme,
    motion: { energy: options.energy ?? 1, seedFor: () => 1, resolveText: () => '' },
    masks: {
      available: true,
      input: (key, source) => {
        inputs.push('url' in source ? source.url : '');

        return `input:${key}`;
      },
      color: (color) => color,
      warn: (message) => warnings.push(message),
      has: options.has ?? (() => true),
    },
  };
  const g = { type: 'fx', effect: 'burst', ...graphic } as FxGraphic;
  const section = { name: 's', type: 'color_background', graphics: [g] } as unknown as Section;
  const filters = lowerFx({ graphic: g, at: 0.4, until: undefined, seed: options.seed ?? 77, index: 1, section, ctx });
  const chains = filters.flatMap((filter) => filter.graph ?? []);

  return { text: render(chains), chains, inputs, warnings };
}

function render(chains: FilterGraphChain[]): string {
  return chains
    .map((chain) => {
      const ins = (chain.inputs ?? []).map((label) => `[${label}]`).join('');
      const outs = (chain.outputs ?? []).map((label) => `[${label}]`).join('');

      return `${ins}${chain.filters.map((f: Filter) => (f.value ? `${f.type}=${String(f.value)}` : f.type)).join(',')}${outs}`;
    })
    .join(';');
}

function count(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

// A 200 px square button in the middle of a 720p frame: its short side is the radius unit.
const HEART = { x: 540, y: 260, w: 200, h: 200 };

describe('fx burst schema', () => {
  it('is a registered primitive with a Marks ceiling', () => {
    expect(REGISTERED_FX).toContain('burst');
    expect(FX_PRIMITIVES.burst.defaults.ceiling).toBeGreaterThanOrEqual(0.85);
    expect(FX_PRIMITIVES.burst.defaults.ceiling * FX_PRIMITIVES.burst.defaults.intensity).toBeGreaterThanOrEqual(0.85);
  });

  it('defaults to a 0.4 s snap on an expo-out travel', () => {
    expect(FX_PRIMITIVES.burst.defaults.duration).toBe(0.4);
    expect(FX_PRIMITIVES.burst.defaults.ease).toBe('cubic-bezier(0.16, 1, 0.3, 1)');
  });

  it('accepts its own parameters and rejects the rest', () => {
    const ok = [
      { effect: 'burst' },
      { effect: 'burst', origin: { x: 0.5, y: 0.2 }, rays: 12, radius: [0.4, 1.4], thickness: 8, length: 0.6 },
      { effect: 'burst', dots: true, spread: 180, rotation: 180, jitter: 0.5, seed: 3, repeat: 2 },
      { effect: 'burst', dots: 6, color: '$color.accent', intensity: 0.7, target: 'layer:0' },
    ];

    for (const graphic of ok) {
      expect(GraphicSchema.safeParse({ type: 'fx', ...graphic }).success, JSON.stringify(graphic)).toBe(true);
    }

    const bad = [
      { effect: 'burst', rays: 3 },
      { effect: 'burst', rays: 40 },
      { effect: 'burst', rays: 6.5 },
      { effect: 'burst', radius: [1.2, 0.5] },
      { effect: 'burst', radius: 1 },
      { effect: 'burst', dots: 30 },
      { effect: 'burst', spread: 400 },
      { effect: 'burst', jitter: 2 },
      { effect: 'burst', count: 8 },
      { effect: 'burst', origin: { x: 0.5 } },
    ];

    for (const graphic of bad) {
      expect(GraphicSchema.safeParse({ type: 'fx', ...graphic }).success, JSON.stringify(graphic)).toBe(false);
    }
  });
});

describe('fx burst lowering', () => {
  it('draws 8 pre-rotated ray sprites by default, no per-frame rotate, opposite rays sharing one sprite', () => {
    const { text, inputs } = lower({ target: HEART, jitter: 0 });
    const specs = inputs.map((url) => parseSpriteUrl(url));

    expect(count(text, /overlay=x=/g)).toBe(8);
    expect(text).not.toContain('rotate');
    expect(specs.every((spec) => spec?.kind === 'ray')).toBe(true);
    // 0°, 45°, 90°, 135° (mod 180): a capsule turned half a turn is itself.
    expect(new Set(specs.map((spec) => spec?.tilt))).toEqual(new Set([0, 45, 90, 135]));
    expect(inputs).toHaveLength(4);
  });

  it('lowers one ray to exact filters: trim, fades, an eased size and a radial overlay path', () => {
    // 4 rays, no jitter, linear: the first ray points straight up from the centre of the heart.
    const { chains, inputs } = lower({
      target: HEART,
      rays: 4,
      jitter: 0,
      ease: 'linear',
      duration: 0.6,
      radius: [0.5, 1],
    });
    const up = parseSpriteUrl(inputs.find((url) => url.includes('tilt=90')) ?? '');
    const [ray] = chains.filter((chain) => chain.outputs?.[0] === 'fx1_ry0');
    const overlay = chains.find((chain) => chain.inputs?.includes('fx1_ry0'))?.filters[0];
    // Visible life: 0.7 of the 0.6 s duration = 0.42 s; head over its first 60 %, tail over its last 70 %.
    const head = easedProgressExpr(parseEasing('linear'), { delay: 0.4, duration: 0.252 });
    const tail = easedProgressExpr(parseEasing('linear'), { delay: 0.526, duration: 0.294 });
    const factor = `clip(((${head})-(${tail}))*2,0.3,1)`;

    // Thickness 6 px at 1080p → 4 px at 720p; length 0.5 of the 100 px travel → 50 px.
    expect(up).toMatchObject({ kind: 'ray', tilt: 90, width: 50, stroke: 4, w: 6, h: 52 });
    expect(ray.filters.map((f) => `${f.type}=${String(f.value)}`)).toEqual([
      'trim=start=0.4:end=0.886667',
      'fade=t=in:st=0.4:d=0.105:alpha=1',
      'fade=t=out:st=0.589:d=0.231:alpha=1',
      `scale=w='max(2,2*trunc(3*(${factor})+0.5))':h='max(2,2*trunc(26*(${factor})+0.5))':eval=frame`,
    ]);
    // Region: a square around the origin (640, 360) of half side 200 + 25 + 4 + 4, snapped outward to even px: x 406, y 126.
    expect(overlay?.value).toBe(
      `x='234+0*((${head})+(${tail}))-overlay_w/2':y='134+-50*((${head})+(${tail}))-overlay_h/2'`
    );
  });

  it('is gone by 70 % of its life: every ray and dot trims and fades out by then', () => {
    // Default duration 0.4 s from at 0.4: nothing draws after 0.4 + 0.7 · 0.4 = 0.68 s.
    // Each branch keeps a fully faded frame past its fade: a layer overlay repeats a branch's last frame
    // until the window ends, so that frame must be clear (2 frames of margin: trim rounds its end to a frame).
    const { chains } = lower({ target: HEART, dots: true });
    const parts = chains.filter((chain) => /fx1_(ry|dt)\d+$/.test(chain.outputs?.[0] ?? ''));
    const done = 0.4 + END * 0.4;

    expect(END).toBe(0.7);
    expect(parts).toHaveLength(12);

    for (const chain of parts) {
      const end = Number(/end=([\d.]+)/.exec(String(chain.filters[0].value))?.[1]);
      const fade = chain.filters.find((f) => String(f.value).startsWith('t=out'));
      const [, st, d] = /st=([\d.]+):d=([\d.]+)/.exec(String(fade?.value)) ?? [];

      expect(Number(st) + Number(d)).toBeLessThanOrEqual(done + 1e-6);
      expect(end).toBeCloseTo(Number(st) + Number(d) + 2 / 30, 5);
    }
  });

  it('breaks the stamp: each ray starts 0–30 ms late and is ±20 % long, from the seed', () => {
    let state = 12345;
    const random = () => {
      state = (state * 1103515245 + 12345) % 2147483648;

      return state / 2147483648;
    };
    const fx = {
      ...burstContext(HEART),
      graphic: { type: 'fx', effect: 'burst', rays: 24 },
      random,
    } as FxContext<'burst'>;
    const rays = planOf(fx)?.rays ?? [];
    const offsets = rays.map((ray) => ray.start - fx.at);
    const lengths = rays.map((ray) => ray.length / (0.5 * (ray.outer - ray.inner)));

    expect(Math.min(...offsets)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...offsets)).toBeLessThanOrEqual(0.03);
    expect(Math.max(...offsets) - Math.min(...offsets)).toBeGreaterThan(0.015);
    expect(Math.min(...lengths)).toBeGreaterThanOrEqual(0.8 - 1e-9);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(1.2 + 1e-9);
    expect(Math.max(...lengths) - Math.min(...lengths)).toBeGreaterThan(0.2);
    // Every ray still ends with the others, at 70 % of the duration.
    expect(rays.every((ray) => Math.abs(ray.start + ray.life - (fx.at + END * fx.duration)) < 1e-9)).toBe(true);
  });

  it('draws fewer, larger dots, each in a gap between two rays', () => {
    const fx = { ...burstContext(HEART), graphic: { type: 'fx', effect: 'burst', dots: true, jitter: 0 } };
    const plan = planOf(fx as FxContext<'burst'>);
    const rays = plan?.rays.map((ray) => ray.angle) ?? [];
    const dots = plan?.dots.map((dot) => dot.angle) ?? [];
    const apart = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

    expect(DOT_SIZE).toBeGreaterThanOrEqual(3.4);
    expect(dots).toHaveLength(4);

    for (const dot of dots) expect(Math.min(...rays.map((ray) => apart(dot, ray)))).toBeCloseTo(22.5, 6);
  });

  it('starts each ray just outside the target edge by default, whatever its shape', () => {
    // A 400 × 100 badge: its size is half its long side, 200, so the rays start 20 px past the edge and
    // travel 110 px.
    const plan = planOf(burstContext({ x: 440, y: 310, w: 400, h: 100 }));
    const at = (angle: number) => plan?.rays.find((ray) => Math.round(ray.angle) === angle);

    expect([at(0)?.inner, at(0)?.outer]).toEqual([220, 330]);
    expect([at(-90)?.inner, at(-90)?.outer]).toEqual([70, 180]);
    expect(at(-45)?.inner).toBeCloseTo(50 * Math.SQRT2 + 20, 6);
    // A square's size is its side: the documented [0.6, 1.15] straight up.
    const square = planOf(burstContext({ x: 540, y: 260, w: 200, h: 200 }))?.rays[0];

    expect([square?.inner, square?.outer]).toEqual([120, 230]);
  });

  it('places rays at the authored spread and rotation: a half burst fans over the top', () => {
    const { inputs } = lower({ target: HEART, rays: 5, spread: 180, jitter: 0 });

    // -180°, -135°, -90°, -45°, 0° → tilts 0, 45, 90, 135, 0.
    expect(new Set(inputs.map((url) => parseSpriteUrl(url)?.tilt))).toEqual(new Set([0, 45, 90, 135]));

    const turned = lower({ target: HEART, rays: 4, jitter: 0, rotation: 30 }).inputs;

    expect(new Set(turned.map((url) => parseSpriteUrl(url)?.tilt))).toEqual(new Set([30, 120]));
  });

  it('adds dots between the rays, from one shared disc sprite', () => {
    const { text, inputs } = lower({ target: HEART, rays: 6, dots: true, jitter: 0 });
    const discs = inputs.map((url) => parseSpriteUrl(url)).filter((spec) => spec?.kind === 'piece');

    expect(discs).toHaveLength(1);
    expect(discs[0]?.shape).toBe('disc');
    expect(count(text, /overlay=x=/g)).toBe(9);
    expect(count(lower({ target: HEART, rays: 6, dots: 2 }).text, /overlay=x=/g)).toBe(8);
  });

  it('defaults to the theme accent and honours an authored colour', () => {
    expect(lower({ target: HEART }, { theme: 'leclap' }).inputs.every((url) => url.includes('c=ff8aae'))).toBe(true);
    expect(lower({ target: HEART, color: '#F96F99' }).inputs.every((url) => url.includes('c=f96f99'))).toBe(true);
  });

  it('is deterministic per seed; jitter varies the rays across seeds', () => {
    expect(lower({ target: HEART }).text).toBe(lower({ target: HEART }).text);
    expect(lower({ target: HEART }, { seed: 1 }).text).not.toBe(lower({ target: HEART }, { seed: 2 }).text);
    expect(lower({ target: HEART, jitter: 0 }, { seed: 1 }).text).toBe(
      lower({ target: HEART, jitter: 0 }, { seed: 2 }).text
    );
  });

  it('repeats passes inside its overlay budget', () => {
    expect(count(lower({ target: HEART, rays: 8, repeat: 3, every: 1 }).text, /overlay=x=/g)).toBe(24);
    expect(
      count(lower({ target: HEART, rays: 24, dots: 12, repeat: 4, every: 1 }).text, /overlay=x=/g)
    ).toBeLessThanOrEqual(48);
  });

  it('rests in reduced motion: the rays still at mid travel, faded in and out', () => {
    const reduced = lower({ target: HEART, dots: true }, { energy: 0 }).text;

    expect(count(reduced, /overlay=x=/g)).toBe(8);
    expect(reduced).not.toContain('eval=frame');
    expect(reduced).not.toContain('(t-');
  });

  it('skips with a warning when scale is missing', () => {
    const { text, warnings } = lower({ target: HEART }, { has: (f) => f !== 'scale' });

    expect(text).toBe('');
    expect(warnings[0]).toContain('fx_skipped');
  });
});

describe('ray sprite', () => {
  it('is a solid anti-aliased capsule along its tilt, transparent off the line', () => {
    const image = spriteImage({ kind: 'ray', w: 52, h: 52, width: 40, stroke: 6, tilt: 45, color: 'ffffff' });
    const alpha = (x: number, y: number): number => image.data[(y * 52 + x) * 4 + 3];

    expect(alpha(26, 26)).toBe(255);
    expect(alpha(26 + 10, 26 + 10)).toBe(255);
    expect(alpha(26 + 10, 26 - 10)).toBe(0);
    expect(alpha(2, 2)).toBe(0);
  });
});
