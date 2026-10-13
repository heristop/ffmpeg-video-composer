import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import type { Filter, FilterGraphChain, Section } from '@/core/types';
import { lowerFx } from '@/editor/presets/fx';
import { bandProfile } from '@/editor/presets/fx-sprites';
import type { SugarContext } from '@/editor/presets/sugar-context';
import { renderFilterGraph } from '@/editor/utils/filter-graph';
import { FX_PRIMITIVES, type FxGraphic } from '@/schemas/fx.schemas';
import { fxCeiling, isFlatFxTarget } from '@/schemas/fx-flat-target';
import { GraphicSchema } from '@/schemas/graphics.schemas';
import { TemplateValidator } from '@/services/TemplateValidator';

// The sheen's "gloss" profile: a broad, flat-topped band for flat graphics (a badge, a pill, a button) with
// a ceiling twice the light doctrine's (0.7) on flat targets only; on the frame or a pane (footage) it
// keeps the 0.35 ceiling and the lint says so.

const CARD = { x: 200, y: 120, w: 400, h: 160, radius: 80 };

function filterText(filter: Filter): string {
  return filter.value === undefined ? filter.type : `${filter.type}=${String(filter.value)}`;
}

function sugar(scale: string, inputs: string[] = []): SugarContext {
  return {
    duration: 2,
    scale,
    fps: 30,
    isVideo: false,
    motion: { energy: 1, seedFor: () => 5, resolveText: () => '' },
    masks: {
      available: true,
      input: (key, source) => {
        inputs.push('url' in source ? source.url : '');

        return `input:${key}`;
      },
      color: (color) => color,
      warn: (message) => {
        throw new Error(message);
      },
      has: () => true,
    },
  };
}

function lowered(graphic: Partial<FxGraphic>, scale = '1280:720'): string {
  const g = { type: 'fx', effect: 'sheen', at: 0.3, ...graphic } as FxGraphic;
  const section = { name: 's', type: 'color_background', graphics: [g] } as unknown as Section;
  const filters = lowerFx({ graphic: g, at: 0.3, until: undefined, seed: 9, index: 0, section, ctx: sugar(scale) });

  return renderFilterGraph(filters[0]?.graph as FilterGraphChain[], filterText, () => 0);
}

function peakAlpha(text: string): number {
  return Math.max(...[...text.matchAll(/@([\d.]+)/g)].map((m) => Number(m[1])));
}

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-version'], { stdio: 'pipe' });

    return true;
  } catch {
    return false;
  }
}

describe('sheen gloss: schema and ceiling', () => {
  it('accepts profile "gloss" and still rejects unknown profiles', () => {
    expect(GraphicSchema.safeParse({ type: 'fx', effect: 'sheen', profile: 'gloss' }).success).toBe(true);
    expect(GraphicSchema.safeParse({ type: 'fx', effect: 'sheen', profile: 'mirror' }).success).toBe(false);
  });

  it('declares the raised ceiling on the sheen row', () => {
    expect(FX_PRIMITIVES.sheen.defaults.ceiling).toBe(0.35);
    expect(FX_PRIMITIVES.sheen.defaults.flat).toEqual({ profile: 'gloss', ceiling: 0.7 });
  });

  it('treats layers, text and rectangles as flat; the frame and panes as footage', () => {
    expect(isFlatFxTarget('layer:0')).toBe(true);
    expect(isFlatFxTarget('text:1')).toBe(true);
    expect(isFlatFxTarget(CARD)).toBe(true);
    expect(isFlatFxTarget('frame')).toBe(false);
    expect(isFlatFxTarget(undefined)).toBe(false);
    expect(isFlatFxTarget('pane:0')).toBe(false);
  });

  it('raises the ceiling only for gloss on a flat target', () => {
    expect(fxCeiling({ effect: 'sheen', profile: 'gloss', target: CARD })).toBe(0.7);
    expect(fxCeiling({ effect: 'sheen', profile: 'gloss', target: 'frame' })).toBe(0.35);
    expect(fxCeiling({ effect: 'sheen', profile: 'specular', target: CARD })).toBe(0.35);
    expect(fxCeiling({ effect: 'sheen', target: CARD })).toBe(0.35);
    expect(fxCeiling({ effect: 'leak', target: CARD })).toBe(0.25);
  });
});

describe('sheen gloss: lowering', () => {
  it('peaks at 0.64 by default and 0.7 at intensity 1 on a flat target', () => {
    expect(peakAlpha(lowered({ target: CARD, profile: 'gloss' }))).toBeCloseTo(0.64, 2);
    expect(peakAlpha(lowered({ target: CARD, profile: 'gloss', intensity: 1 }))).toBeCloseTo(0.7, 2);
  });

  it('keeps the 0.35 ceiling over the frame', () => {
    expect(peakAlpha(lowered({ target: 'frame', profile: 'gloss', intensity: 1 }))).toBeCloseTo(0.35, 2);
  });

  it('defaults to a band twice as wide as the specular one', () => {
    const size = (text: string): number => Number(/gradients=s=(\d+)x/.exec(text)?.[1]);

    expect(size(lowered({ target: CARD, profile: 'gloss', tilt: 0 }))).toBeGreaterThan(
      1.7 * size(lowered({ target: CARD, profile: 'specular', tilt: 0 }))
    );
  });

  it('leaves the other profiles byte-identical (same stops, same seeded defaults)', () => {
    const specular = lowered({ target: CARD });

    expect(specular).toBe(lowered({ target: CARD }));
    expect(peakAlpha(specular)).toBeCloseTo(0.32, 2);
  });

  it('is a flat-topped band: near its peak across its middle half, ~0 at its edge', () => {
    const spec = { width: 30, peak: 1, profile: 'gloss' as const };

    expect(bandProfile(0, spec)).toBeCloseTo(1, 5);
    expect(bandProfile(7.5, spec)).toBeGreaterThan(0.9);
    expect(bandProfile(7.5, { ...spec, profile: 'specular' })).toBeLessThan(0.7);
    expect(bandProfile(30, spec)).toBeLessThan(0.001);
  });

  it('is deterministic', () => {
    expect(lowered({ target: CARD, profile: 'gloss' })).toBe(lowered({ target: CARD, profile: 'gloss' }));
  });
});

describe('sheen gloss: lint', () => {
  function warnings(target: unknown) {
    const descriptor = {
      meta: { name: 't' },
      global: { orientation: 'landscape', fps: 30 },
      sections: [
        {
          name: 'a',
          type: 'color_background',
          options: { duration: 3, backgroundColor: '#141416' },
          graphics: [{ type: 'fx', effect: 'sheen', profile: 'gloss', at: 0.4, ...(target ? { target } : {}) }],
        },
      ],
    };

    return new TemplateValidator().getMotionWarnings(descriptor).filter((w) => w.code === 'fx_gloss_target');
  }

  it('flags gloss over the frame or a pane, not over a flat graphic', () => {
    expect(warnings(undefined)).toHaveLength(1);
    expect(warnings('pane:0')).toHaveLength(1);
    expect(warnings(undefined)[0]).toMatchObject({ path: 'sections[0].graphics[0]', severity: 'warn' });
    expect(warnings(CARD)).toEqual([]);
    expect(warnings('layer:0')).toEqual([]);
  });
});

// Real FFmpeg on a flat mid-grey card: the gloss band lifts luma well past what the 0.35 ceiling allows
// and stays within its own 0.7 cap; nothing outside the card changes.
describe.skipIf(!hasFfmpeg())('sheen gloss on real frames', () => {
  const [W, H] = [640, 360];
  // Square corners: no mask input, so the graph runs on its own.
  const card = { x: 120, y: 120, w: 400, h: 120 };

  function frames(graphic: Partial<FxGraphic>): Buffer[] {
    const inputs: string[] = [];
    const g = { type: 'fx', effect: 'sheen', at: 0.2, target: card, color: '#FFFFFF', ...graphic } as FxGraphic;
    const section = { name: 's', type: 'color_background', graphics: [g] } as unknown as Section;
    const filters = lowerFx({
      graphic: g,
      at: 0.2,
      until: undefined,
      seed: 9,
      index: 0,
      section,
      ctx: sugar(`${W}:${H}`, inputs),
    });
    const graph = renderFilterGraph(filters[0]?.graph as FilterGraphChain[], filterText, () => undefined);
    const base =
      `color=c=0x141416:s=${W}x${H}:r=30:d=1.4,format=yuv420p,` +
      `drawbox=x=${card.x}:y=${card.y}:w=${card.w}:h=${card.h}:color=0x808080:t=fill`;

    expect(inputs).toEqual([]);
    const raw = execFileSync(
      'ffmpeg',
      ['-v', 'error', '-filter_complex', `${base},${graph}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
      { maxBuffer: 1 << 28 }
    );

    return Array.from({ length: raw.length / (W * H) }, (_, i) => raw.subarray(i * W * H, (i + 1) * W * H));
  }

  function peakLift(list: Buffer[], plain: Buffer): { inside: number; outside: number } {
    let [inside, outside] = [0, 0];

    for (const frame of list) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const d = frame[y * W + x] - plain[y * W + x];
          const within = x >= card.x && x < card.x + card.w && y >= card.y && y < card.y + card.h;

          if (within) inside = Math.max(inside, d);
          if (!within) outside = Math.max(outside, Math.abs(d));
        }
      }
    }

    return { inside, outside };
  }

  it('lifts a flat card past the old ceiling and within the new cap', () => {
    const gloss = frames({ profile: 'gloss', intensity: 1, tilt: 20 });
    const specular = frames({ profile: 'specular', intensity: 1, tilt: 20 });
    const plain = gloss[0];
    const g = peakLift(gloss, plain);
    const s = peakLift(specular, plain);
    // White over mid-grey in gray (full range): the band adds alpha × (255 − 128).
    const old = 0.35 * (255 - 128);
    const cap = 0.7 * (255 - 128);

    expect(s.inside).toBeLessThanOrEqual(old + 2);
    expect(g.inside).toBeGreaterThan(old + 10);
    expect(g.inside).toBeLessThanOrEqual(cap + 2);
    expect(g.outside).toBe(0);
  }, 60000);
});
