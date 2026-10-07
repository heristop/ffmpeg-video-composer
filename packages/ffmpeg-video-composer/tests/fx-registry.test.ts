import { describe, expect, it } from 'vitest';
import type { Filter, FilterGraphChain, Section } from '@/core/types';
import { motionCatalog } from '@/core/motion/catalog';
import { graphicTiming, graphicsToFilters } from '@/editor/presets/graphics';
import { defaultLightColor, lowerFx } from '@/editor/presets/fx';
import { lightInTarget, passProgress, staticHighlight, type AnyFxContext } from '@/editor/presets/fx-kit';
import type { SugarContext } from '@/editor/presets/sugar-context';
import { FX_PRIMITIVES, FxGraphicSchema } from '@/schemas/fx.schemas';
import { describeFxPrimitives } from '@/schemas/fx-docs';
import { templateDescriptorJsonSchema } from '@/schemas/template.schemas';
import { GraphicSchema, type Graphic } from '@/schemas/graphics.schemas';

const FRAME = { width: 1280, height: 720, fps: 30 };

function sugar(warnings: string[] = [], effects = true): SugarContext {
  return {
    duration: 3,
    scale: '1280:720',
    fps: 30,
    isVideo: false,
    motion: { energy: 1, seedFor: () => 11, resolveText: (text) => text.en ?? '' },
    masks: {
      available: true,
      input: (key) => `input:${key}`,
      color: (color) => color,
      warn: (message) => warnings.push(message),
      has: () => true,
      ...(effects ? { effects: lowerFx } : {}),
    },
  };
}

function section(graphics: unknown[]): Section {
  return { name: 's', type: 'color_background', options: { duration: 3 }, graphics } as unknown as Section;
}

function fakeContext(overrides: Partial<AnyFxContext> = {}): AnyFxContext {
  return {
    graphic: { type: 'fx', effect: 'sheen' },
    target: { x: 200, y: 120, w: 400, h: 240, radius: 0, mask: 'none' },
    frame: FRAME,
    at: 0.5,
    duration: 0.75,
    passes: 1,
    every: 1.95,
    end: 1.25,
    ease: 'cubic-bezier(0.45, 0, 0.2, 1)',
    color: '#FFF8EE',
    peak: 0.32,
    energy: 1,
    reduced: false,
    seed: 42,
    random: () => 0.5,
    prefix: 'fx0_',
    has: () => true,
    sprite: (key) => `input:fx0_${key}`,
    ...overrides,
  };
}

function render(graph: FilterGraphChain[]): string {
  return graph
    .map((chain) => {
      const ins = (chain.inputs ?? []).map((label) => `[${label}]`).join('');
      const outs = (chain.outputs ?? []).map((label) => `[${label}]`).join('');

      return `${ins}${chain.filters.map((f) => (f.value ? `${f.type}=${String(f.value)}` : f.type)).join(',')}${outs}`;
    })
    .join(';');
}

describe('fx schema', () => {
  it('accepts a primitive with its own parameters and rejects unknown ones', () => {
    const sheen = { type: 'fx', effect: 'sheen', target: { x: 0, y: 0, w: 100, h: 60, radius: 12 }, tilt: -12 };

    expect(GraphicSchema.safeParse(sheen).success).toBe(true);
    expect(GraphicSchema.safeParse({ ...sheen, repeat: 3, every: 2, seed: 4, intensity: 0.5 }).success).toBe(true);
    expect(GraphicSchema.safeParse({ ...sheen, sparkle: true }).success).toBe(false);
    expect(GraphicSchema.safeParse({ ...sheen, effect: 'nope' }).success).toBe(false);
    expect(GraphicSchema.safeParse({ ...sheen, intensity: 2 }).success).toBe(false);
  });

  const MARKS = new Set(['ripple', 'glint', 'confetti']);

  it('documents every parameter of every primitive', () => {
    describeFxPrimitives();

    for (const variant of FxGraphicSchema.options) {
      expect(variant.description, variant.shape.effect.value).toMatch(/ Tune: /);
    }

    for (const [name, row] of Object.entries(FX_PRIMITIVES)) {
      for (const [key, schema] of Object.entries(row.params)) {
        expect((schema as { description?: string }).description?.length ?? 0, `${name}.${key}`).toBeGreaterThan(20);
      }

      // Light washes stay under the doctrine's 0.35; marks (a ring, a star point, paper confetti) are solid.
      expect(row.defaults.ceiling).toBeLessThanOrEqual(MARKS.has(name) ? 1 : 0.35);
      expect(row.defaults.ceiling * row.defaults.intensity).toBeLessThanOrEqual(row.defaults.ceiling);
    }
  });
});

describe('fx prose', () => {
  // The JSON schema LLM authors read carries every field's description and each primitive's intent, although
  // the rows themselves hold none (the browser's validation never loads fx-docs.ts).
  it('reaches the JSON schema', () => {
    const json = JSON.stringify(templateDescriptorJsonSchema);

    expect(json).toContain('Light profile across the band: specular');
    expect(json).toContain('Where the burst starts, as fractions of the target');
    expect(json).toContain('Drift heading in degrees, screen convention');
    expect(json).toContain('A frosted glass panel on the target rectangle');
  });
});

describe('fx dispatch', () => {
  it('lowers to nothing on the validation path (no effects lowering in the context)', () => {
    const filters = graphicsToFilters(section([{ type: 'fx', effect: 'sheen' }]), sugar([], false), false);

    expect(filters).toEqual([]);
  });

  it('draws above text only on a text target by default', () => {
    const textual = GraphicSchema.parse({ type: 'fx', effect: 'sheen', target: 'text:0' }) as Graphic;
    const framed = GraphicSchema.parse({ type: 'fx', effect: 'sheen' }) as Graphic;

    expect(graphicsToFilters(section([textual]), sugar([], false), true)).toEqual([]);
    expect(graphicTiming(framed, FRAME).holds).toBe(false);
  });

  it('times repeats: span = (repeat - 1) × every + duration', () => {
    const g = GraphicSchema.parse({ type: 'fx', effect: 'sheen', duration: 0.5, repeat: 3, every: 1 }) as Graphic;

    expect(graphicTiming(g, FRAME).duration).toBeCloseTo(2.5, 6);
  });

  it('skips a target that names nothing, with a warning', () => {
    const warnings: string[] = [];
    const g = { type: 'fx', effect: 'sheen', target: 'pane:2' };

    expect(
      lowerFx({
        graphic: g as never,
        at: 0,
        until: undefined,
        seed: 1,
        index: 0,
        section: section([g]),
        ctx: sugar(warnings),
      })
    ).toEqual([]);
    expect(warnings.join()).toMatch(/fx_target|fx_unavailable/);
  });

  it('tints the default light toward the theme accent, deterministically', () => {
    expect(defaultLightColor(undefined)).toMatch(/^#[0-9A-F]{6}$/);
    expect(defaultLightColor({ extends: 'leclap', colors: { accent: '#FF0000' } })).not.toBe(
      defaultLightColor({ extends: 'leclap', colors: { accent: '#0000FF' } })
    );
    expect(defaultLightColor(undefined)).toBe(defaultLightColor(undefined));
  });
});

describe('fx kit', () => {
  const band = {
    chains: [{ filters: [{ type: 'color', value: 'c=white' }], outputs: ['fx0_b'] }],
    label: 'fx0_b',
    x: '0',
    y: '0',
  };

  it('crops the target for the window only and composites back with eof pass and an enable window', () => {
    const text = render(lightInTarget(fakeContext(), [band]) ?? []);

    expect(text).toContain('format=yuv420p,split=2[fx0_m][fx0_r0]');
    expect(text).toContain('[fx0_r0]trim=end=1.25,crop=400:240:200:120[fx0_r]');
    expect(text).toContain("[fx0_r][fx0_b]overlay=x='0':y='0'[fx0_o0]");
    expect(text).toContain("[fx0_m][fx0_o0]overlay=200:120:eof_action=pass:enable='between(t,0.5,1.25)'");
    expect(text).not.toContain('alphamerge');
  });

  it('clips a rounded target with a generated grayscale mask', () => {
    const rounded = fakeContext({ target: { x: 200, y: 120, w: 400, h: 240, radius: 24, mask: 'rounded' } });
    const text = render(lightInTarget(rounded, [band]) ?? []);

    expect(text).toContain('[fx0_o0][input:fx0_mask]alphamerge[fx0_l]');
    expect(text).toContain('[fx0_m][fx0_l]overlay=200:120');
    expect(lightInTarget({ ...rounded, sprite: () => null }, [band])).toBeNull();
  });

  it('clips a text target with the glyph mask, cropped to the block', () => {
    const glyph = { type: 'drawtext', values: { fontcolor: 'white' } } as Filter;
    const text = render(
      lightInTarget(
        fakeContext({ target: { x: 100, y: 50, w: 300, h: 120, radius: 0, mask: 'text', textMask: [glyph] } }),
        [band]
      ) ?? []
    );

    expect(text).toContain('color=c=black:s=1280x720:r=30:d=1.25,format=gray,drawtext,lutyuv=');
    expect(text).toContain('crop=300:120:100:50[fx0_k]');
    expect(text).toContain('[fx0_o0][fx0_k]alphamerge[fx0_l]');
  });

  it('repeats passes on a modulo clock and offers a reduced-motion highlight', () => {
    expect(passProgress(fakeContext({ passes: 3, every: 2 }))).toContain('mod(t-0.5,2)');
    expect(passProgress(fakeContext())).not.toContain('mod(');

    const still = render(staticHighlight(fakeContext(), 0.08).chains);

    expect(still).toContain('color=c=#FFF8EE@0.08:s=400x240:r=30:d=0.75');
    expect(still).toContain('fade=t=in:st=0.5');
    expect(still).toContain('fade=t=out');
  });
});

describe('fx catalog', () => {
  it('presents primitives with open parameters and design intent, not finished looks', () => {
    const fx = motionCatalog().fx;

    expect(Object.keys(fx.primitives)).toEqual(Object.keys(FX_PRIMITIVES));
    expect(fx.shared).toHaveProperty('target');
    expect(fx.shared).toHaveProperty('seed');
    expect(fx.rules.join(' ')).toMatch(/Compose, do not pick/);

    for (const entry of Object.values(fx.primitives)) {
      expect(Object.keys(entry.params).length).toBeGreaterThan(2);
      expect(entry.vary.length).toBeGreaterThan(40);
    }
  });
});
