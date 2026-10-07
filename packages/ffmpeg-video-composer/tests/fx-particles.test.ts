import { describe, expect, it } from 'vitest';
import type { Filter, FilterGraphChain, Section } from '@/core/types';
import { lowerFx } from '@/editor/presets/fx';
import { parseSpriteUrl, spriteImage } from '@/editor/presets/fx-sprites';
import type { SugarContext } from '@/editor/presets/sugar-context';
import { FxGraphicSchema, type FxGraphic } from '@/schemas/fx.schemas';

// bokeh and dust: ambient particles under the 0.12 ceiling, deterministic, spread outside the clear zone,
// absent under reduced motion, parametric (count, size, drift...) and different per seed.

interface Lowered {
  text: string;
  chains: FilterGraphChain[];
  inputs: string[];
  warnings: string[];
}

function lower(graphic: Partial<FxGraphic>, options: { energy?: number; seed?: number; scale?: string } = {}): Lowered {
  const inputs: string[] = [];
  const warnings: string[] = [];
  const ctx: SugarContext = {
    duration: 6,
    scale: options.scale ?? '1280:720',
    fps: 25,
    isVideo: false,
    motion: { energy: options.energy ?? 1, seedFor: () => 1, resolveText: () => '' },
    masks: {
      available: true,
      input: (key, source) => {
        inputs.push('url' in source ? source.url : '');

        return `input:${key}`;
      },
      color: (color) => color,
      warn: (message) => warnings.push(message),
      has: () => true,
    },
  };
  const g = { type: 'fx', effect: 'bokeh', duration: 5, ...graphic } as FxGraphic;
  const section = { name: 's', type: 'color_background', graphics: [g] } as unknown as Section;
  const filters = lowerFx({ graphic: g, at: 0.2, until: undefined, seed: options.seed ?? 11, index: 1, section, ctx });
  const chains = filters.flatMap((filter) => filter.graph ?? []);
  const text = chains
    .map((chain) => chain.filters.map((f: Filter) => (f.value ? `${f.type}=${String(f.value)}` : f.type)).join(','))
    .join(';');

  return { text, chains, inputs, warnings };
}

function alphas(text: string): number[] {
  return [...text.matchAll(/lutyuv=a='val\*([\d.]+)'/g)].map((m) => Number(m[1]));
}

const NUM = String.raw`(-?[\d.]+)`;
const DRIFT = new RegExp(String.raw`^${NUM}\+${NUM}\*\(t-${NUM}\)\+${NUM}\*sin\(${NUM}\*\(t-[\d.]+\)\+${NUM}\)$`);

// A particle coordinate `a+v*(t-at)+s*sin(w*(t-at)+phase)` at section time t.
function evaluate(expr: string, t: number): number {
  const [a, v, at, s, w, phase] = (DRIFT.exec(expr) ?? []).slice(1).map(Number);

  return a + v * (t - at) + s * Math.sin(w * (t - at) + phase);
}

// The particles' overlay positions (sprite top-left, target px) at section time t.
function positionsAt(chains: FilterGraphChain[], t: number): Array<[number, number]> {
  return chains.flatMap((chain) =>
    chain.filters.flatMap((f) => {
      const m = /^x='([^']+)':y='([^']+)'$/.exec(String(f.value ?? ''));

      return f.type === 'overlay' && m ? [[evaluate(m[1], t), evaluate(m[2], t)] as [number, number]] : [];
    })
  );
}

describe('fx bokeh', () => {
  it('validates its parameters', () => {
    expect(
      FxGraphicSchema.safeParse({ type: 'fx', effect: 'bokeh', count: 8, size: 0.12, softness: 0.4, drift: -80 })
        .success
    ).toBe(true);
    expect(FxGraphicSchema.safeParse({ type: 'fx', effect: 'bokeh', count: 40 }).success).toBe(false);
    expect(FxGraphicSchema.safeParse({ type: 'fx', effect: 'bokeh', flicker: 0.5 }).success).toBe(false);
  });

  it('draws 6–10 discs from three bokeh sprites, every one at or under 0.12 alpha', () => {
    const { text, inputs, warnings } = lower({});
    const discs = alphas(text);

    expect(warnings).toEqual([]);
    expect(inputs).toHaveLength(3);
    expect(inputs.every((url) => parseSpriteUrl(url)?.kind === 'bokeh')).toBe(true);
    expect(discs.length).toBeGreaterThanOrEqual(6);
    expect(discs.length).toBeLessThanOrEqual(10);
    expect(Math.max(...discs)).toBeLessThanOrEqual(0.12);
    expect(text).toContain('noise=c3s=3:c3f=u:');
    expect(text).toMatch(/fade=t=in:st=0\.\d+:d=[\d.]+:alpha=1/);
    expect(text).toContain("overlay=0:0:eof_action=pass:enable='between(t,0.2,5.2)'");
  });

  it('keeps intensity 1 at the ceiling and honours count', () => {
    const { text } = lower({ intensity: 1, count: 12 });

    expect(alphas(text)).toHaveLength(12);
    expect(Math.max(...alphas(text))).toBeLessThanOrEqual(0.12);
  });

  it('keeps the centre clear at mid-window', () => {
    const { chains, inputs } = lower({ count: 10, clear: 0.3, speed: 0 });
    const sides = inputs.map((url) => parseSpriteUrl(url)?.w ?? 0);
    // Particle j's tier: the sprite input its split branch comes from.
    const tierOf = new Map(
      chains.flatMap((chain) =>
        chain.filters.some((f) => f.type === 'split')
          ? (chain.outputs ?? []).map((label) => [label.replace('fx1_s', ''), Number(chain.inputs?.[0]?.at(-1))])
          : []
      )
    );
    const tops = positionsAt(chains, 2.7);

    expect(tops).toHaveLength(10);
    for (const [j, [x, y]] of tops.entries()) {
      const side = sides[tierOf.get(String(j)) ?? -1];
      // Sway moves a disc by at most 2.5 % of the short side around its sampled point.
      const [cx, cy] = [(x + side / 2) / 1280, (y + side / 2) / 720];

      expect(Number.isFinite(cx) && Number.isFinite(cy)).toBe(true);
      expect(Math.max(Math.abs(cx - 0.5), Math.abs(cy - 0.5))).toBeGreaterThan(0.3 - 0.026);
    }
  });

  it('is absent under reduced motion, without a warning', () => {
    const { chains, warnings, inputs } = lower({}, { energy: 0 });

    expect(chains).toEqual([]);
    expect(inputs).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('is deterministic per seed and differs between seeds', () => {
    expect(lower({}).text).toBe(lower({}).text);
    expect(lower({}, { seed: 12 }).text).not.toBe(lower({}).text);
    expect(lower({ seed: 4 }).text).not.toBe(lower({}).text);
  });

  it('renders a soft disc sprite with a slightly brighter rim and a clean edge', () => {
    const image = spriteImage({ kind: 'bokeh', w: 64, h: 64, radius: 20, halo: 4 });
    const at = (x: number) => image.data[(32 * 64 + x) * 4 + 3];

    expect(at(32)).toBeGreaterThan(200);
    expect(at(32 + 17)).toBeGreaterThan(at(32));
    expect(at(1)).toBe(0);
  });
});

describe('fx dust', () => {
  it('draws seeded motes from two odd-sized disc sprites under the ceiling', () => {
    const { text, inputs, warnings } = lower({ effect: 'dust' });
    const motes = alphas(text);

    expect(warnings).toEqual([]);
    expect(inputs.map((url) => parseSpriteUrl(url)?.kind)).toEqual(['disc', 'disc']);
    expect(inputs.every((url) => (parseSpriteUrl(url)?.w ?? 0) % 2 === 1)).toBe(true);
    expect(motes.length).toBeGreaterThanOrEqual(16);
    expect(Math.max(...motes)).toBeLessThanOrEqual(0.12);
  });

  it('keeps every life inside the window, with ramps of at least 4 frames', () => {
    const { text } = lower({ effect: 'dust', flicker: 1 });
    const fades = [...text.matchAll(/fade=t=(in|out):st=([\d.]+):d=([\d.]+)/g)].map((m) => ({
      start: Number(m[2]),
      length: Number(m[3]),
    }));

    expect(fades.length).toBeGreaterThan(0);

    for (const fade of fades) {
      expect(fade.start).toBeGreaterThanOrEqual(0.2 - 1e-6);
      expect(fade.start + fade.length).toBeLessThanOrEqual(5.2 + 1e-6);
      expect(fade.length).toBeGreaterThanOrEqual(4 / 25 - 1e-6);
    }
  });

  it('flicker 0 keeps every mote for the whole effect', () => {
    const { text } = lower({ effect: 'dust', flicker: 0, count: 10 });

    expect(alphas(text)).toHaveLength(10);
    expect([...text.matchAll(/fade=t=in:st=([\d.]+)/g)].every((m) => Number(m[1]) === 0.2)).toBe(true);
  });

  it('scales the motes with the frame and is absent under reduced motion', () => {
    const small = parseSpriteUrl(lower({ effect: 'dust' }, { scale: '640:360' }).inputs[1] ?? '');
    const large = parseSpriteUrl(lower({ effect: 'dust' }, { scale: '1920:1080' }).inputs[1] ?? '');

    expect(large?.sigma ?? 0).toBeGreaterThan(small?.sigma ?? 0);
    expect(lower({ effect: 'dust' }, { energy: 0 }).chains).toEqual([]);
  });
});
