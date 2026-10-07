// The live preview's bridge to the engine: the target, colour, timing and seed an effect is drawn with must
// be the ones the compile path would use, so the canvas shows the render's composition.
import { describe, expect, it } from 'vitest';
import type { Graphic } from 'ffmpeg-video-composer/src/schemas/graphics.schemas.ts';
import { defaultLightColor } from 'ffmpeg-video-composer/src/editor/presets/fx-color.ts';
import { deriveSeed, fnv1a32 } from 'ffmpeg-video-composer/src/core/determinism/hash.ts';
import { resolveTheme } from 'ffmpeg-video-composer/src/core/theme/resolve.ts';
import { bandOf } from 'ffmpeg-video-composer/src/editor/presets/fx-sheen.ts';
import type { FxContext } from 'ffmpeg-video-composer/src/editor/presets/fx-kit.ts';
import { newSection, type EditorSection } from '../../templateEditorModel';
import {
  curveOf,
  fxSeed,
  fxWindow,
  previewColor,
  previewFxContext,
  previewTarget,
  sectionName,
  themeColor,
  type PreviewEnv,
} from './fx-context';

const THEME = { extends: 'leclap', colors: { accent: '#FF3366' } };

function card(): EditorSection {
  return {
    ...newSection('color'),
    layers: [{ color: '#111111' }, { color: '#333366', x: 'iw*0.25', y: 'ih*0.2', w: 'iw*0.5', h: 'ih*0.6' }],
  } as EditorSection;
}

function env(overrides: Partial<PreviewEnv> = {}): PreviewEnv {
  return {
    orientation: 'landscape',
    section: card(),
    sectionIndex: 2,
    sectionSeconds: 6,
    theme: THEME,
    reduced: false,
    ...overrides,
  };
}

type Fx = Extract<Graphic, { type: 'fx' }>;
const fx = (fields: Record<string, unknown>): Fx => ({ type: 'fx', ...fields }) as Fx;

describe('previewTarget', () => {
  it('resolves the frame, a layer (frame fractions) and a rounded rectangle in output px', () => {
    expect(previewTarget(undefined, env())).toEqual({ x: 0, y: 0, w: 1280, h: 720, radius: 0, mask: 'none' });
    expect(previewTarget('layer:1', env())).toEqual({ x: 320, y: 144, w: 640, h: 432, radius: 0, mask: 'none' });
    expect(previewTarget({ x: 100, y: 50, w: 200, h: 80, radius: 60 }, env())).toEqual({
      x: 100,
      y: 50,
      w: 200,
      h: 80,
      radius: 40,
      mask: 'rounded',
    });
  });

  it('clamps to the frame and names nothing for a missing layer or an off-frame box', () => {
    expect(previewTarget({ x: 1200, y: 600, w: 400, h: 400 }, env())).toMatchObject({ x: 1200, y: 600, w: 80, h: 120 });
    expect(previewTarget('layer:7', env())).toBeNull();
    expect(previewTarget({ x: 2000, y: 0, w: 100, h: 100 }, env())).toBeNull();
  });

  it('follows the orientation and shows panes and text blocks on the frame', () => {
    expect(previewTarget('frame', env({ orientation: 'portrait' }))).toMatchObject({ w: 720, h: 1280 });
    expect(previewTarget('pane:1', env())).toMatchObject({ x: 0, y: 0, w: 1280, h: 720 });
  });
});

describe('colours', () => {
  it('uses the engine default light (tinted by the theme accent) when unset', () => {
    expect(previewColor(undefined, THEME)).toBe(defaultLightColor(THEME));
  });

  it('resolves theme tokens and drops an @alpha', () => {
    const accent = resolveTheme(THEME as never)?.colors.accent;

    expect(previewColor('$color.accent', THEME)).toBe(accent);
    expect(previewColor('#00FF00@0.4', THEME)).toBe('#00FF00');
    expect(themeColor('$color.accent@0.5', THEME)).toBe(`${accent}@0.5`);
    expect(themeColor('#123456', THEME)).toBe('#123456');
  });
});

describe('fxWindow', () => {
  it('snaps the default pass to the frame grid and scales it with the energy', () => {
    const sheen = fx({ effect: 'sheen', at: 0.5 });

    const window = fxWindow(sheen, 1);

    expect(window).toMatchObject({ at: 0.5, duration: 23 / 30, passes: 1 });
    expect(window?.every).toBeCloseTo(23 / 30 + 1.2);
    expect(window?.end).toBeCloseTo(0.5 + 23 / 30);
    expect(fxWindow(sheen, 2)?.duration).toBeLessThan(23 / 30);
  });

  it('repeats passes `every` seconds, stops at `until` and reads a time reference as the section start', () => {
    const repeated = fxWindow(fx({ effect: 'ripple', duration: 1, repeat: 3, every: 2 }), 1);

    expect(repeated).toMatchObject({ at: 0, passes: 3, every: 2, end: 5 });
    expect(fxWindow(fx({ effect: 'ripple', duration: 1, repeat: 3, every: 2, until: 3 }), 1)?.end).toBe(3);
    expect(fxWindow(fx({ effect: 'sheen', at: 'beat:4' }), 1)?.at).toBe(0);
    expect(fxWindow(fx({ effect: 'sheen', at: 2, until: 1 }), 1)).toBeNull();
  });
});

describe('seeds and names', () => {
  it('names sections the way the descriptor builder does', () => {
    expect(sectionName(card(), 2)).toBe('color_2');
    expect(sectionName(newSection('video'), 0)).toBe('video_0');
  });

  it('derives the element seed from global.seed and its path, mixed with its own seed', () => {
    const base = deriveSeed(7, 'sections.color_2.graphics[1]');

    expect(fxSeed(fx({ effect: 'sheen' }), 1, env({ globalSeed: 7 }))).toBe(base);
    expect(fxSeed(fx({ effect: 'sheen', seed: 42 }), 1, env({ globalSeed: 7 }))).toBe(fnv1a32(`${base}:42`));
  });
});

describe('previewFxContext', () => {
  it('builds the engine context: target, peak under the ceiling, eased curve and colour', () => {
    const context = previewFxContext(
      fx({ effect: 'sheen', target: 'layer:1', intensity: 0.5, color: '#FFFFFF' }),
      0,
      env()
    );

    expect(context).toMatchObject({ target: { x: 320, w: 640 }, peak: 0.35 * 0.5, color: '#FFFFFF', reduced: false });
    expect(context?.frame).toEqual({ width: 1280, height: 720, fps: 30 });
  });

  it('turns reduced motion into the engine energy 0', () => {
    expect(previewFxContext(fx({ effect: 'sheen' }), 0, env({ reduced: true }))).toMatchObject({
      energy: 0,
      reduced: true,
    });
  });

  it('has no context for a stroke graphic or a target that names nothing', () => {
    expect(previewFxContext({ type: 'frame' } as Graphic, 0, env())).toBeNull();
    expect(previewFxContext(fx({ effect: 'sheen', target: 'layer:5' }), 0, env())).toBeNull();
  });

  it('feeds the engine plans the authored parameters (sheen band: tilt, width, direction)', () => {
    const context = previewFxContext(
      fx({ effect: 'sheen', target: 'layer:1', tilt: 20, width: 0.25, direction: 'left' }),
      0,
      env()
    ) as FxContext<'sheen'>;
    const band = bandOf(context);

    expect(band.tilt).toBeCloseTo((20 * Math.PI) / 180);
    expect(band.width).toBeCloseTo(0.25 * 432);
    expect(band).toMatchObject({ horizontal: true, forward: false });
  });

  it('keeps the context defaults of an untuned effect stable for one seed', () => {
    const a = bandOf(previewFxContext(fx({ effect: 'sheen' }), 0, env()) as FxContext<'sheen'>);
    const b = bandOf(previewFxContext(fx({ effect: 'sheen' }), 0, env()) as FxContext<'sheen'>);
    const other = bandOf(previewFxContext(fx({ effect: 'sheen', seed: 9 }), 0, env()) as FxContext<'sheen'>);

    expect(a).toEqual(b);
    expect(other.tilt).not.toBe(a.tilt);
  });
});

describe('curveOf', () => {
  it('resolves motion tokens and falls back to linear on an unknown spec', () => {
    expect(curveOf('$smooth')(0.5)).toBeCloseTo(curveOf('cubic-bezier(0.4, 0, 0.2, 1)')(0.5));
    expect(curveOf('not-a-curve')(0.3)).toBe(0.3);
  });
});
