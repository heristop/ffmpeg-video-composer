// Parameters → drawing: each graphic's painter carries the engine plan the render uses, so a tweak in the
// effect panel moves what the canvas draws the same way it moves the render.
import { describe, expect, it } from 'vitest';
import type { Graphic } from 'ffmpeg-video-composer/src/schemas/graphics.schemas.ts';
import type { FxContext } from 'ffmpeg-video-composer/src/editor/presets/fx-kit.ts';
import type { FxEffectName } from 'ffmpeg-video-composer/src/schemas/fx-primitives.schemas.ts';
import type { OutlineRequest } from 'ffmpeg-video-composer/src/editor/presets/stroke-kit.ts';
import { bandOf } from 'ffmpeg-video-composer/src/editor/presets/fx-sheen.ts';
import { planOf as ripplePlan, ringWindow } from 'ffmpeg-video-composer/src/editor/presets/fx-ripple.ts';
import { planOf as glintPlan } from 'ffmpeg-video-composer/src/editor/presets/fx-glint.ts';
import { bokehField } from 'ffmpeg-video-composer/src/editor/presets/fx-particles.ts';
import { newSection, type EditorSection } from '../../templateEditorModel';
import { previewFxContext, type PreviewEnv } from './fx-context';
import { preparePainter } from './prepare';
import { sheenAlong } from './paint-light';
import { passStarts, ringAt, starScale } from './paint-marks';
import { particleAt } from './paint-texture';
import { outlineBox, sampleAt, strokeRequest, type StrokeGraphic } from './paint-stroke';

function section(): EditorSection {
  return {
    ...newSection('color'),
    color: '#101020',
    layers: [{ color: '#101020' }, { color: '#30306a', x: 320, y: 144, w: 640, h: 432 }],
  } as EditorSection;
}

const env = (overrides: Partial<PreviewEnv> = {}): PreviewEnv => ({
  orientation: 'landscape',
  section: section(),
  sectionIndex: 0,
  sectionSeconds: 6,
  reduced: false,
  ...overrides,
});

function context<N extends FxEffectName = 'sheen'>(fields: Record<string, unknown>, e = env()): FxContext<N> {
  return previewFxContext({ type: 'fx', ...fields } as Graphic, 0, e) as unknown as FxContext<N>;
}

describe('preparePainter', () => {
  it('outlines a card target, loops the effect window and draws on the canvas', () => {
    const painter = preparePainter({ type: 'fx', effect: 'sheen', target: 'layer:1', at: 1 } as Graphic, 0, env());

    expect(painter?.outline).toMatchObject({ x: 320, y: 144, w: 640, h: 432 });
    expect(painter?.span[0]).toBeCloseTo(0.65);
    expect(painter?.paint).toBeTypeOf('function');
  });

  it('does not outline a whole-frame effect, and draws picture effects as a surface', () => {
    const glass = preparePainter({ type: 'fx', effect: 'glass' } as Graphic, 0, env());

    expect(glass?.outline).toBeNull();
    expect(glass?.surface?.(1)).toMatchObject({ box: { x: 0, y: 0, w: 1280, h: 720 }, opacity: 1 });
  });

  it('leaves out what reduced motion drops, and keeps the reduced stand-in of the rest', () => {
    expect(preparePainter({ type: 'fx', effect: 'bokeh' } as Graphic, 0, env({ reduced: true }))?.absent).toBe(true);
    expect(
      preparePainter({ type: 'fx', effect: 'sheen' } as Graphic, 0, env({ reduced: true }))?.absent
    ).toBeUndefined();
  });

  it('previews strokes through the engine plans and nothing for the other graphics', () => {
    // A plain corners graphic has the engine's box too: the frame minus its 56 px inset.
    expect(preparePainter({ type: 'corners', at: 0.2 } as Graphic, 0, env())?.outline).toEqual({
      x: 56,
      y: 56,
      w: 1168,
      h: 608,
    });
    expect(preparePainter({ type: 'frame', target: 'layer:1', trace: 'path' } as Graphic, 0, env())?.outline).toEqual({
      x: 296,
      y: 120,
      w: 688,
      h: 480,
    });
    expect(preparePainter({ type: 'flash' } as Graphic, 0, env())).toBeNull();
    expect(preparePainter({ type: 'fx', effect: 'sheen', target: 'layer:9' } as Graphic, 0, env())).toBeNull();
  });
});

describe('sheen', () => {
  it('sweeps the band from fully before the target to fully past it', () => {
    const band = bandOf(context({ effect: 'sheen', target: 'layer:1', direction: 'right' }));

    expect(sheenAlong(band, 640, 0)).toBeCloseTo(-band.along / 2);
    expect(sheenAlong(band, 640, 1)).toBeCloseTo(640 + band.along / 2);
    expect(sheenAlong({ ...band, forward: false }, 640, 0)).toBeCloseTo(640 + band.along / 2);
  });
});

describe('ripple', () => {
  it('grows each ring from its start size while its alpha decays, rings staggered', () => {
    const fx = context<'ripple'>({ effect: 'ripple', target: 'layer:1', rings: 2, start: 0.4, duration: 1 });
    const plan = ripplePlan(fx);

    if (!plan) throw new Error('no plan');

    const [first, second] = passStarts(fx).flatMap((t0) => [0, 1].map((i) => ringWindow(fx, plan, t0, i)));
    const early = ringAt(fx, plan, first, first.start + 0.01);
    const late = ringAt(fx, plan, first, first.start + first.life * 0.8);

    expect(second.start).toBeGreaterThan(first.start);
    expect(early?.scale).toBeCloseTo(0.4, 1);
    expect(late?.scale).toBeGreaterThan(early?.scale ?? 1);
    expect(late?.alpha).toBeLessThan(fx.peak * 0.1);
    expect(ringAt(fx, plan, first, first.start - 0.1)).toBeNull();
  });

  it('places the rings at the authored origin of the target', () => {
    const fx = context<'ripple'>({ effect: 'ripple', target: 'layer:1', origin: { x: 0, y: 0 } });
    const plan = ripplePlan(fx);

    expect(fx.target.x + (plan?.cx ?? 0)).toBe(320);
    expect(fx.target.y + (plan?.cy ?? 0)).toBe(144);
  });
});

describe('glint and particles', () => {
  it('grows a star then shrinks it back to nothing', () => {
    const fx = context<'glint'>({ effect: 'glint', target: 'layer:1', count: 3 });
    const star = glintPlan(fx)?.stars[0];

    if (!star) throw new Error('no star');

    const peak = starScale(fx, star, star.start + star.life * 0.45);

    expect(peak).toBeGreaterThan(starScale(fx, star, star.start + star.life * 0.1));
    expect(starScale(fx, star, star.start + star.life)).toBeCloseTo(0);
  });

  it('drifts a bokeh disc along its heading', () => {
    const fx = context<'bokeh'>({ effect: 'bokeh', drift: 0, speed: 0.1, count: 4 });
    const disc = bokehField(fx).particles[0];
    const [x0] = particleAt(fx, disc, fx.at);
    const [x1] = particleAt(fx, disc, fx.at + 2);

    expect(x1 - x0).toBeCloseTo(disc.vx * 2, 0);
    expect(disc.vx).toBeGreaterThan(0);
  });
});

describe('strokes', () => {
  it('frames the frame minus the inset, or the target plus the clearance', () => {
    const plain = strokeRequest({ type: 'corners' } as StrokeGraphic, 0, env()) as OutlineRequest;
    const around = strokeRequest(
      { type: 'frame', target: 'layer:1', clearance: 10 } as StrokeGraphic,
      0,
      env()
    ) as OutlineRequest;

    expect(outlineBox(plain, env())).toEqual({ x: 56, y: 56, w: 1168, h: 608 });
    expect(outlineBox(around, env())).toEqual({ x: 310, y: 134, w: 660, h: 452 });
  });

  it('resolves theme colours the way the compile path does', () => {
    const request = strokeRequest(
      { type: 'frame', color: '$color.accent' } as StrokeGraphic,
      0,
      env({ theme: { extends: 'leclap', colors: { accent: '#FF0000' } } })
    );

    expect(request.ctx.masks?.color('$color.accent')).toBe('#FF0000');
    expect(request.section).toMatchObject({ type: 'color_background', options: { backgroundColor: '#101020' } });
  });

  it('finds the sample of a section time', () => {
    const samples = [
      { from: 0, to: 1, pose: { levels: [], grow: 0, alpha: 1 } },
      { from: 1, to: undefined, pose: { levels: [], grow: 0, alpha: 0.5 } },
    ];

    expect(sampleAt(samples, 0.5)).toBe(samples[0]);
    expect(sampleAt(samples, 9)).toBe(samples[1]);
    expect(sampleAt(samples, -1)).toBeNull();
  });
});
