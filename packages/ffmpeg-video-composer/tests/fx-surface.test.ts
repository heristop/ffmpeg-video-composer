import { describe, expect, it } from 'vitest';
import type { Section } from '@/core/types';
import { lowerFx } from '@/editor/presets/fx';
import { GLASS_LUMA, lumaBand, yuvOf, type GlassLook } from '@/editor/presets/fx-glass';
import { parseSpriteUrl } from '@/editor/presets/fx-sprites';
import type { SugarContext } from '@/editor/presets/sugar-context';
import { KineticBlockSchema } from '@/schemas/kinetic.schemas';
import { FxGraphicSchema, type FxGraphic } from '@/schemas/fx.schemas';

// glass and resolve lowerings: parameters, the contrast solver, the per-frame defocus steps, reduced
// motion and the device fallbacks. Pixels are checked in fx-surface-render.test.ts.

interface Options {
  energy?: number;
  has?: (filter: string) => boolean;
}

function lower(graphic: Partial<FxGraphic>, options: Options = {}) {
  const inputs: string[] = [];
  const warnings: string[] = [];
  const ctx: SugarContext = {
    duration: 3,
    scale: '1280:720',
    fps: 25,
    isVideo: false,
    motion: { energy: options.energy ?? 1, seedFor: () => 1, resolveText: () => 'LECLAP' },
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
  const g = { type: 'fx', effect: 'glass', ...graphic } as FxGraphic;
  const kinetic = [KineticBlockSchema.parse({ text: { en: 'LECLAP' }, preset: 'fade', size: 96 })];
  const section = { name: 's', type: 'color_background', kinetic, graphics: [g] } as unknown as Section;
  const filters = lowerFx({ graphic: g, at: 0.4, until: undefined, seed: 21, index: 0, section, ctx });
  const text = filters
    .flatMap((filter) => filter.graph ?? [])
    .map((chain) => chain.filters.map((f) => (f.value ? `${f.type}=${String(f.value)}` : f.type)).join(','))
    .join(';');

  return { text, inputs, warnings };
}

const CARD = { x: 120, y: 480, w: 640, h: 140, radius: 28 };

function look(tone: 'dark' | 'light', tint: number[], mix: number): GlassLook {
  return { tone, frost: 10, saturation: 0.5, rim: 0.2, ramp: 0.3, tint, mix };
}

describe('fx glass', () => {
  it('validates its parameters', () => {
    expect(FxGraphicSchema.safeParse({ type: 'fx', effect: 'glass', tone: 'light', frost: 0.1 }).success).toBe(true);
    expect(FxGraphicSchema.safeParse({ type: 'fx', effect: 'glass', tone: 'smoke' }).success).toBe(false);
  });

  it('frosts a copy of the region, tones it in one lutyuv, lights its rim and ramps in and out', () => {
    const { text, inputs, warnings } = lower({ target: CARD, duration: 3 });

    expect(warnings).toEqual([]);
    expect(text).toMatch(/crop=640:140:120:480,format=yuv420p,split=2/);
    expect(text).toMatch(/gblur=sigma=[\d.]+,lutyuv=y='[\d.]+\+[\d.]+\*clip\(val,16,235\)':u='[\d.]+\+[\d.]+\*val'/);
    expect(text).toContain('noise=c0s=2:c0f=t+u');
    expect(text).toContain('fade=t=in:st=0.4:d=0.3:alpha=1');
    expect(text).toContain('fade=t=out:st=3.1:d=0.3:alpha=1');
    expect(inputs.map((url) => parseSpriteUrl(url)?.kind)).toEqual(['rim', 'mask']);
  });

  it('solves the luma band so the tinted glass keeps its contrast whatever the tint', () => {
    for (const tint of [
      [1, 1, 1],
      [1, 0.8, 0],
      [0.05, 0.05, 0.05],
    ]) {
      for (const mix of [0, 0.15, 0.3]) {
        const tintY = (yuvOf(tint)[0] - 16) / 219;
        const [, high] = lumaBand(look('dark', tint, mix));
        const [low] = lumaBand(look('light', tint, mix));

        expect((1 - mix) * high + mix * tintY).toBeLessThanOrEqual(GLASS_LUMA.darkMax + 1e-9);
        expect((1 - mix) * low + mix * tintY).toBeGreaterThanOrEqual(GLASS_LUMA.lightMin - 1e-9);
      }
    }
  });

  it('keeps toning without gblur, and does not change under reduced motion', () => {
    const plain = lower({ target: CARD });

    expect(lower({ target: CARD }, { has: (f) => f !== 'gblur' }).text).not.toContain('gblur');
    expect(lower({ target: CARD }, { energy: 0 }).text).toBe(plain.text);
    expect(lower({ target: CARD, highlight: 0 }).inputs.map((url) => parseSpriteUrl(url)?.kind)).toEqual(['mask']);
  });
});

describe('fx resolve', () => {
  const RECT = { x: 440, y: 260, w: 400, h: 200 };

  function sigmas(text: string): Array<{ sigma: number; from: number; to: number }> {
    return [...text.matchAll(/gblur=sigma=([\d.]+):enable='between\(t,([\d.]+),([\d.]+)\)'/g)].map((m) => ({
      sigma: Number(m[1]),
      from: Number(m[2]),
      to: Number(m[3]),
    }));
  }

  it('steps the defocus down frame by frame in at least 8 non-overlapping windows', () => {
    const { text, warnings } = lower({ effect: 'resolve', target: RECT });
    const steps = sigmas(text);

    expect(warnings).toEqual([]);
    expect(steps.length).toBeGreaterThanOrEqual(8);

    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].sigma).toBeLessThan(steps[i - 1].sigma);
      expect(steps[i].from).toBeCloseTo(steps[i - 1].to, 5);
    }

    expect(steps[0].from).toBeCloseTo(0.4 - 0.02, 5);
  });

  it('settles the scale with zoompan, glows from the section start and feathers its edge', () => {
    const { text, inputs } = lower({ effect: 'resolve', target: RECT });

    // The exact sub-pixel zoom on the region: knot table on the frame index, cropped back to the region.
    expect(text).toMatch(/setpts=N\/\(25\*TB\),scale=w='st\(0,max\(1,if\(lt\(round\(t\*25\),11\),1\.0[3-5]\d*,/);
    expect(text).toMatch(/zoompan=z='[^']*':x='[^']*':y='[^']*':d=1:s=\d+x\d+:fps=25/);
    expect(text).toMatch(/overlay=0:0:enable='lt\(t,[\d.]+\)'/);
    expect(text).toContain("overlay=440:260:eof_action=pass:enable='between(t,0,1.12)'");
    expect(text).toContain('fade=t=in:st=0.4:d=');
    expect(inputs.map((url) => parseSpriteUrl(url)?.kind)).toEqual(['feather']);
  });

  it('resolves a text block on its widened box, never on the glyph mask', () => {
    const { text, warnings, inputs } = lower({ effect: 'resolve', target: 'text:0' });

    expect(warnings).toEqual([]);
    expect(text).toContain('zoompan');
    expect(inputs.map((url) => parseSpriteUrl(url)?.kind)).toEqual(['feather']);
    expect(text).not.toContain('drawtext');
    expect(text).not.toMatch(/\[\w+]\[input:fx0_mask]/);
  });

  it('is a plain cross-fade under reduced motion, and degrades on missing filters', () => {
    const reduced = lower({ effect: 'resolve', target: RECT }, { energy: 0 }).text;

    expect(sigmas(reduced)).toEqual([]);
    expect(reduced).not.toContain('zoompan');
    expect(reduced).toContain('fade=t=in:st=0.4:d=0.72:alpha=1');
    expect(lower({ effect: 'resolve', target: RECT }, { has: (f) => f !== 'zoompan' }).text).not.toContain('zoompan');
    expect(lower({ effect: 'resolve', target: RECT }, { has: (f) => f !== 'alphamerge' }).inputs).toEqual([]);

    const blind = lower({ effect: 'resolve', target: RECT }, { has: (f) => f !== 'gblur' });

    expect(blind.text).toBe('');
    expect(blind.warnings.join()).toContain('fx_skipped');
  });
});
