import { describe, expect, it } from 'vitest';
import { decodeCommands, parseSvgPath } from '@/editor/presets/path-svg';
import { MAX_SHAPE_PIXELS, MAX_SHAPE_SIDE } from '@/editor/presets/shape-raster';
import { peakScale, planShape } from '@/editor/presets/shape-plan';
import type { ShapeRequest } from '@/editor/presets/sugar-context';

function request(
  graphic: Record<string, unknown>,
  options: { warnings?: string[]; at?: number; until?: number; scale?: string; available?: boolean } = {}
): ShapeRequest {
  return {
    graphic: { type: 'shape', ...graphic },
    at: options.at ?? 0.5,
    until: options.until,
    seed: 7,
    index: 0,
    section: {
      name: 's',
      type: 'color_background',
      options: { duration: 3, layers: [{ x: 100, y: 80, w: 300, h: 200 }] },
    },
    ctx: {
      duration: 3,
      scale: options.scale ?? '1280:720',
      fps: 30,
      isVideo: false,
      masks: {
        available: options.available ?? true,
        input: (key: string) => `input:${key}`,
        color: (c: string) => c,
        warn: (message: string) => options.warnings?.push(message),
      },
    },
  } as unknown as ShapeRequest;
}

describe('planShape', () => {
  it('boxes a star on even pixels around its outline, at density 1, in the brand colour, fading in', () => {
    const plan = planShape(request({ preset: { type: 'star' }, duration: 0.5 }, { at: 1 }));

    expect(plan?.box).toEqual({ x: 500, y: 214, w: 280, h: 266 });
    expect(plan?.density).toBe(1);
    expect(plan?.spec).toMatchObject({ w: 280, h: 266, rule: 'nonzero', fill: 'solid', c1: '7c83fdff', sw: 0 });
    expect(decodeCommands(plan?.spec?.path ?? '')).not.toBeNull();
    expect(plan?.outline).toBeNull();
    expect(plan?.animate).toEqual({
      opacity: [
        { t: 1, v: 0 },
        { t: 1.5, v: 1, ease: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      ],
    });
  });

  it('keeps authored tracks as they are', () => {
    const animate = { scale: [{ v: 0 }, { t: 0.6, v: 1 }] };

    expect(planShape(request({ preset: { type: 'heart' }, animate }))?.animate).toBe(animate);
  });

  it('refuses a shape more than twice the frame, before rasterising anything', () => {
    const warnings: string[] = [];

    expect(planShape(request({ d: 'M0 0 L100000 0 L100000 100000 Z' }, { warnings }))).toBeNull();
    expect(planShape(request({ preset: { type: 'rect' }, width: 20000, height: 300 }, { warnings }))).toBeNull();
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/^\[shape_too_large\] graphics\[0\] shape: /);
  });

  it('supersamples for a scale track while it fits the pixel budget', () => {
    const warnings: string[] = [];
    const plan = planShape(
      request(
        {
          preset: { type: 'rect' },
          x: 0,
          y: 0,
          width: 1280,
          height: 720,
          animate: { scale: [{ v: 0 }, { t: 1, v: 2 }] },
        },
        { warnings }
      )
    );

    expect(plan?.box).toEqual({ x: -2, y: -2, w: 1284, h: 724 });
    expect(plan?.density).toBe(2);
    expect(plan?.spec).toMatchObject({ w: 2568, h: 1448 });
    expect(warnings).toEqual([]);
  });

  it('draws a near-frame shape at 1080p below full resolution, within the budget, with an advisory', () => {
    const warnings: string[] = [];
    const plan = planShape(
      request(
        {
          preset: { type: 'rect' },
          x: 0,
          y: 0,
          width: 3800,
          height: 2100,
          animate: { scale: [{ v: 1 }, { t: 1, v: 2 }] },
        },
        { warnings, scale: '1920:1080' }
      )
    );
    const spec = plan?.spec;

    expect(plan?.density).toBeLessThan(1);
    expect((spec?.w ?? 0) * (spec?.h ?? 0)).toBeLessThanOrEqual(MAX_SHAPE_PIXELS);
    expect(spec?.w).toBeLessThanOrEqual(MAX_SHAPE_SIDE);
    expect(warnings.map((w) => w.split(']')[0])).toEqual(['[shape_downsampled']);
  });

  it('skips a shape whose target names nothing', () => {
    const warnings: string[] = [];

    expect(planShape(request({ preset: { type: 'star' }, target: 'layer:5' }, { warnings }))).toBeNull();
    expect(warnings[0]).toMatch(/^\[shape_target\]/);
  });

  it('hands a drawn outline to the path graphic and fades the fill in once it closes', () => {
    const plan = planShape(
      request({
        preset: { type: 'heart' },
        color: '#f96f99',
        duration: 1,
        stroke: { draw: true, color: '#ffffff', width: 6 },
      })
    );

    expect(plan?.outline).toMatchObject({
      type: 'path',
      thickness: 6,
      color: '#ffffff',
      duration: 1,
      caps: 'round',
      exit: 'none',
    });
    expect(parseSvgPath(plan?.outline?.d ?? '')).not.toBeNull();
    expect(plan?.spec?.sw).toBe(0);
    expect(plan?.animate.opacity?.[0]).toEqual({ t: 1.5, v: 0 });
    expect(plan?.animate.opacity?.[1].t).toBeCloseTo(1.8, 9);
  });

  it('bakes the outline into the image when the engine cannot draw it on', () => {
    const warnings: string[] = [];
    const plan = planShape(
      request(
        { preset: { type: 'heart' }, stroke: { draw: true, color: '#ffffff', width: 6 } },
        { warnings, available: false }
      )
    );

    expect(plan?.outline).toBeNull();
    expect(plan?.spec).toMatchObject({ sw: 6, sc: 'ffffffff' });
    expect(warnings[0]).toMatch(/^\[shape_draw_unavailable\]/);
  });

  it('resolves gradients to rrggbbaa stops and falls back on a colour it cannot draw', () => {
    const warnings: string[] = [];
    const gradient = planShape(
      request({ preset: { type: 'blob' }, gradient: { from: '#ff0000', to: '#0000ff@0.5', shape: 'radial' } })
    );
    const bad = planShape(request({ preset: { type: 'star' }, color: 'nonsense' }, { warnings }));

    expect(gradient?.spec).toMatchObject({ fill: 'radial', c1: 'ff0000ff', c2: '0000ff80' });
    expect(bad?.spec?.c1).toBe('7c83fdff');
    expect(warnings[0]).toMatch(/^\[shape_color\]/);
  });
  it('refuses a spec the asset stage would refuse, with the reason', () => {
    const warnings: string[] = [];
    const d = `M0 0 ${Array.from({ length: 12000 }, (_, i) => `L${(i * 7) % 200} ${(i * 13) % 200}`).join(' ')} Z`;

    expect(planShape(request({ d }, { warnings }))).toBeNull();
    expect(warnings[0]).toMatch(/^\[shape_too_large\] graphics\[0\] shape: /);
    expect(warnings).toHaveLength(1);
  });

  it('refuses a dense outline before measuring it, even when only its stroke is drawn on', () => {
    const warnings: string[] = [];
    const d = `M0 0 ${Array.from({ length: 12 }, (_, i) => `C0 2000 2000 -2000 ${i % 2 ? 0 : 2000} 0`).join(' ')}`;
    const graphic = { d, fill: false, stroke: { draw: true } };

    expect(planShape(request(graphic, { warnings }))).toBeNull();
    expect(warnings[0]).toMatch(/^\[shape_too_large\] graphics\[0\] shape: /);
    expect(warnings).toHaveLength(1);
  });
});

describe('peakScale', () => {
  it('multiplies the largest uniform and axis scales, never below 1', () => {
    expect(peakScale(undefined)).toBe(1);
    expect(peakScale({ scale: [{ v: 0 }, { t: 1, v: 1.5 }], scaleX: [{ v: 2 }] })).toBe(3);
    expect(peakScale({ scale: [{ v: 0.5 }] })).toBe(1);
  });
});
