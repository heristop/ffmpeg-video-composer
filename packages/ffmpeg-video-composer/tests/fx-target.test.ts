import { describe, expect, it } from 'vitest';
import type { Section } from '@/core/types';
import { resolveFxTarget, snapToFrame } from '@/editor/presets/fx-target';
import type { SugarContext } from '@/editor/presets/sugar-context';
import { FxTargetSchema } from '@/schemas/fx.schemas';
import { KineticBlockSchema } from '@/schemas/kinetic.schemas';

function ctx(scale: string): SugarContext {
  return {
    duration: 3,
    scale,
    fps: 30,
    isVideo: false,
    motion: { energy: 1, seedFor: () => 7, resolveText: (text) => text.en ?? '' },
  };
}

const plain = { name: 's', type: 'color_background', options: { duration: 3 } } as unknown as Section;

function env(scale: string, section: Section = plain) {
  return { section, ctx: ctx(scale) };
}

describe('fx target schema', () => {
  it('accepts every target kind and rejects malformed ones', () => {
    for (const target of ['frame', 'pane:1', 'layer:0', 'text:2', { x: 10, y: 'ih*0.1', w: 'iw*0.5', h: 200 }]) {
      expect(FxTargetSchema.safeParse(target).success, JSON.stringify(target)).toBe(true);
    }

    for (const target of ['video', 'pane:x', 'text:-1', { x: 1, y: 1, w: 'iw/2', h: 1 }, { x: 0, y: 0, w: 1 }]) {
      expect(FxTargetSchema.safeParse(target).success, JSON.stringify(target)).toBe(false);
    }
  });
});

describe('resolveFxTarget', () => {
  it('defaults to the whole frame in every format', () => {
    for (const [scale, w, h] of [
      ['1280:720', 1280, 720],
      ['1080:1920', 1080, 1920],
      ['1080:1080', 1080, 1080],
    ] as const) {
      expect(resolveFxTarget(undefined, env(scale))).toEqual({ x: 0, y: 0, w, h, radius: 0, mask: 'none' });
      expect(resolveFxTarget('frame', env(scale))).toEqual({ x: 0, y: 0, w, h, radius: 0, mask: 'none' });
    }
  });

  it('resolves a rectangle in px or frame fractions, snapped inward to even pixels', () => {
    const rect = resolveFxTarget({ x: 101, y: 51, w: 400, h: 201, radius: 24 }, env('1280:720'));

    expect(rect).toEqual({ x: 102, y: 52, w: 398, h: 200, radius: 24, mask: 'rounded' });

    const portrait = resolveFxTarget({ x: 'iw*0.1', y: 'ih*0.25', w: 'iw*0.8', h: 'ih*0.5' }, env('1080:1920'));

    expect(portrait).toEqual({ x: 108, y: 480, w: 864, h: 960, radius: 0, mask: 'none' });

    for (const value of Object.values(portrait ?? {}).filter((v) => typeof v === 'number')) {
      expect((value as number) % 2).toBe(0);
    }
  });

  it('clamps out-of-frame rectangles and drops ones fully outside', () => {
    expect(resolveFxTarget({ x: -50, y: 600, w: 300, h: 300 }, env('1080:1080'))).toMatchObject({
      x: 0,
      y: 600,
      w: 250,
      h: 300,
    });
    expect(resolveFxTarget({ x: 2000, y: 0, w: 100, h: 100 }, env('1280:720'))).toBeNull();
    expect(snapToFrame({ x: 10, y: 10, w: 1, h: 50 }, 100, 100)).toBeNull();
  });

  it('caps the radius at half the shorter side', () => {
    expect(resolveFxTarget({ x: 0, y: 0, w: 100, h: 40, radius: 90 }, env('1280:720'))?.radius).toBe(20);
  });

  it('resolves layout panes and background layers', () => {
    const split = {
      ...plain,
      layout: { type: 'split', sources: ['#ff0000', '#00ff00'], gap: 10 },
    } as unknown as Section;

    expect(resolveFxTarget('pane:1', env('1280:720', split))).toEqual({
      x: 646,
      y: 0,
      w: 634,
      h: 720,
      radius: 0,
      mask: 'none',
    });
    expect(resolveFxTarget('pane:3', env('1280:720', split))).toBeNull();
    expect(resolveFxTarget('pane:0', env('1280:720'))).toBeNull();

    const layered = {
      ...plain,
      options: { duration: 3, layers: [{ color: '#fff', x: 'iw*0.1', y: 90, w: 'iw*0.5', h: 'ih*0.5' }] },
    } as unknown as Section;

    expect(resolveFxTarget('layer:0', env('1080:1080', layered))).toEqual({
      x: 108,
      y: 90,
      w: 540,
      h: 540,
      radius: 0,
      mask: 'none',
    });
    expect(resolveFxTarget('layer:1', env('1080:1080', layered))).toBeNull();
  });

  it('resolves a kinetic block to its box and a white glyph mask', () => {
    const block = KineticBlockSchema.parse({ text: { en: 'Shine' }, preset: 'rise', size: 120 });
    const section = { ...plain, kinetic: [block] } as unknown as Section;
    const rect = resolveFxTarget('text:0', env('1280:720', section));

    expect(rect?.mask).toBe('text');
    expect(rect && rect.w > 100 && rect.h > 40).toBe(true);
    expect(rect && rect.x % 2 === 0 && rect.y % 2 === 0 && rect.w % 2 === 0 && rect.h % 2 === 0).toBe(true);
    expect(rect?.textMask?.every((filter) => filter.type === 'drawtext')).toBe(true);
    expect(JSON.stringify(rect?.textMask)).toContain('white');
    expect(resolveFxTarget('text:1', env('1280:720', section))).toBeNull();
  });
});
