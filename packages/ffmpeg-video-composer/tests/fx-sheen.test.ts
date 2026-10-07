import { describe, expect, it } from 'vitest';
import type { Filter, FilterGraphChain, Section } from '@/core/types';
import { lowerFx, REGISTERED_FX } from '@/editor/presets/fx';
import type { SugarContext } from '@/editor/presets/sugar-context';
import { FX_PRIMITIVES, type FxGraphic } from '@/schemas/fx.schemas';

interface Options {
  energy?: number;
  has?: (filter: string) => boolean;
  seed?: number;
  scale?: string;
}

function lower(
  graphic: Partial<FxGraphic>,
  options: Options = {}
): { text: string; inputs: string[]; warnings: string[] } {
  const inputs: string[] = [];
  const warnings: string[] = [];
  const ctx: SugarContext = {
    duration: 3,
    scale: options.scale ?? '1280:720',
    fps: 30,
    isVideo: false,
    motion: { energy: options.energy ?? 1, seedFor: () => 1, resolveText: () => '' },
    masks: {
      available: true,
      input: (key, source) => {
        inputs.push(`${key}=${'url' in source ? source.url : ''}`);

        return `input:${key}`;
      },
      color: (color) => color,
      warn: (message) => warnings.push(message),
      has: options.has ?? (() => true),
    },
  };
  const g = { type: 'fx', effect: 'sheen', ...graphic } as FxGraphic;
  const section = { name: 's', type: 'color_background', graphics: [g] } as unknown as Section;
  const filters = lowerFx({ graphic: g, at: 0.4, until: undefined, seed: options.seed ?? 77, index: 2, section, ctx });

  return { text: render(filters), inputs, warnings };
}

function render(filters: Filter[]): string {
  const chains = filters.flatMap((filter) => filter.graph ?? []);

  return chains
    .map((chain: FilterGraphChain) => {
      const ins = (chain.inputs ?? []).map((label) => `[${label}]`).join('');
      const outs = (chain.outputs ?? []).map((label) => `[${label}]`).join('');

      return `${ins}${chain.filters.map((f) => (f.value ? `${f.type}=${String(f.value)}` : f.type)).join(',')}${outs}`;
    })
    .join(';');
}

const CARD = { x: 200, y: 120, w: 400, h: 240, radius: 24 };

describe('fx sheen', () => {
  it('is registered for every primitive row it implements', () => {
    expect(REGISTERED_FX).toEqual(Object.keys(FX_PRIMITIVES));
  });

  it('lowers to a band-sized gradient with 7 stops, transparent ends, crossing the target once', () => {
    const { text } = lower({ target: CARD, tilt: 20, width: 0.15 });
    const source = /gradients=s=(\d+)x(\d+):([^,]*)/.exec(text);

    expect(source).not.toBeNull();
    // Band-sized, never the frame: narrower than the target, taller by the blur margin only.
    expect(Number(source?.[1])).toBeLessThan(CARD.w);
    expect(Number(source?.[2])).toBeGreaterThan(CARD.h);
    expect(Number(source?.[2])).toBeLessThan(CARD.h + 40);
    expect(source?.[3]).toMatch(/c0=#[0-9A-F]{6}@0:.*c6=#[0-9A-F]{6}@0:nb_colors=7/);
    expect(source?.[3]).toMatch(/speed=0.00001:seed=\d+:r=30:d=0.766667/);
    expect(text).toContain('setpts=PTS+0.4/TB');
    expect(text).toContain('noise=c3s=3:c3f=u:all_seed=');
    expect(text).toContain('trim=end=1.166667,crop=400:240:200:120');
    expect(text).toContain("overlay=200:120:eof_action=pass:enable='between(t,0.4,1.166667)'");
    expect(text).toContain('[fx2_o0][input:fx2_mask]alphamerge[fx2_l]');
  });

  it('peaks at 0.32 alpha by default and maps intensity under the 0.35 ceiling', () => {
    const peak = (text: string): number => Math.max(...[...text.matchAll(/@([\d.]+)/g)].map((m) => Number(m[1])));

    expect(peak(lower({ target: CARD }).text)).toBeCloseTo(0.32, 2);
    expect(peak(lower({ target: CARD, intensity: 1 }).text)).toBeCloseTo(0.35, 2);
    expect(peak(lower({ target: CARD, intensity: 0.5 }).text)).toBeCloseTo(0.175, 2);
  });

  it('is deterministic for a seed, and different element paths dither differently', () => {
    expect(lower({ target: CARD }).text).toBe(lower({ target: CARD }).text);

    const seedOf = (text: string): string | undefined => /all_seed=(\d+)/.exec(text)?.[1];

    expect(seedOf(lower({ target: CARD }, { seed: 1 }).text)).not.toBe(
      seedOf(lower({ target: CARD }, { seed: 2 }).text)
    );
    // The element's own `seed` re-rolls it too.
    expect(lower({ target: CARD, seed: 3 }).text).not.toBe(lower({ target: CARD }).text);
  });

  it('derives untuned defaults from the context: seed-picked tilt and width, path from the target shape', () => {
    const size = (text: string): string | undefined => /gradients=s=(\d+x\d+)/.exec(text)?.[1];
    const sizes = new Set([1, 2, 3, 4, 5].map((seed) => size(lower({ target: CARD }, { seed }).text)));

    expect(sizes.size).toBeGreaterThan(2);

    const tall = lower({ target: { x: 100, y: 100, w: 300, h: 800 } }, { scale: '720:1280' }).text;

    expect(tall).toMatch(/overlay=x='-\d+':y='-\d+\+/);
    expect(lower({ target: CARD }).text).toMatch(/overlay=x='-\d+\+\d+\*/);
  });

  it('honours every authored look parameter', () => {
    const base = lower({ target: CARD, tilt: 20, width: 0.15 }).text;

    for (const change of [
      { profile: 'twin' },
      { profile: 'soft' },
      { width: 0.3 },
      { tilt: -10 },
      { direction: 'left' },
      { direction: 'up' },
      { bloom: 0 },
      { color: '#88CCFF' },
      { duration: 1.2 },
      { ease: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    ] as const) {
      expect(lower({ target: CARD, tilt: 20, width: 0.15, ...change }).text, JSON.stringify(change)).not.toBe(base);
    }

    expect(lower({ target: CARD, color: '#88CCFF' }).text).toContain('#88CCFF@');
  });

  it('repeats passes on a modulo clock and stops at `until`', () => {
    const { text } = lower({ target: CARD, repeat: 3, every: 2 });

    expect(text).toContain('mod(t-0.4,2)');
    expect(text).toContain("enable='between(t,0.4,5.166667)'");
  });

  it('runs quicker at higher motion energy and becomes a still highlight at energy 0', () => {
    expect(lower({ target: CARD }, { energy: 2 }).text).toContain('d=0.533333');

    const reduced = lower({ target: CARD }, { energy: 0 }).text;

    expect(reduced).not.toContain('gradients');
    expect(reduced).toContain('@0.08:s=400x240');
    expect(reduced).toContain('fade=t=in');
  });

  it('falls back to a compile-time band sprite without gradients, and skips without alphamerge masks', () => {
    const fallback = lower({ target: CARD, tilt: 20 }, { has: (filter) => filter !== 'gradients' });

    expect(fallback.text).not.toContain('gradients');
    expect(fallback.inputs.some((input) => input.startsWith('fx2_band=sprite:kind=band'))).toBe(true);
    expect(fallback.text).toContain('[input:fx2_band]format=yuva444p');
  });

  it('clips a rectangle without radius by the crop alone (no mask input)', () => {
    const { text, inputs } = lower({ target: { x: 0, y: 0, w: 640, h: 360 } });

    expect(text).not.toContain('alphamerge');
    expect(inputs).toEqual([]);
  });
});
