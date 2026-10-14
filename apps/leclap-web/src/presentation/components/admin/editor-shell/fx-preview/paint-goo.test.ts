// The goo preview evaluates the engine's blob plan at the section time and unites the blobs the way the
// render does: close blobs fuse through a neck, far ones stay apart.
import { describe, expect, it } from 'vitest';
import type { Graphic } from 'ffmpeg-video-composer/src/schemas/graphics.schemas.ts';
import type { FxContext } from 'ffmpeg-video-composer/src/editor/presets/fx-kit.ts';
import { blobsAt, gooPlan } from 'ffmpeg-video-composer/src/editor/presets/fx-goo-plan.ts';
import { newSection, type EditorSection } from '../../templateEditorModel';
import { previewFxContext, type PreviewEnv } from './fx-context';
import { gooCoverage } from './paint-goo';
import { preparePainter } from './prepare';

const env: PreviewEnv = {
  orientation: 'landscape',
  section: { ...newSection('color'), layers: [{ color: '#141416' }] } as EditorSection,
  sectionIndex: 0,
  sectionSeconds: 3,
  reduced: false,
};
const graphic = { type: 'fx', effect: 'goo', at: 0.2, duration: 2.6 } as Graphic;

describe('goo preview', () => {
  it('prepares a painter over the effect window', () => {
    const painter = preparePainter(graphic, 0, env);

    expect(painter?.paint).toBeTypeOf('function');
    expect(painter?.span[0]).toBeLessThanOrEqual(0.2);
  });

  it('samples the choreography: nothing before the pop, droplets apart mid-way, one blob merged', () => {
    const fx = previewFxContext(graphic, 0, env) as unknown as FxContext<'goo'>;
    const plan = gooPlan(fx.graphic, fx.target, fx);
    const [main, ...drops] = blobsAt(plan, 0.2 + 2.6 * 0.5);

    expect(blobsAt(plan, 0.2).every((blob) => blob.r === 0)).toBe(true);
    expect(drops.length).toBeGreaterThanOrEqual(1);
    expect(Math.hypot(drops[0].cx - main.cx, drops[0].cy - main.cy)).toBeGreaterThan(main.r + drops[0].r);
    const merged = blobsAt(plan, 0.2 + 2.6 * 0.88);

    expect(merged.every((blob) => Math.hypot(blob.cx - merged[0].cx, blob.cy - merged[0].cy) < 1)).toBe(true);
  });

  it('fuses close blobs and keeps far ones apart, with an anti-aliased edge', () => {
    const grid = { x0: 0, y0: 0, w: 200, h: 100, step: 1 };
    const row = (gap: number): Float32Array => {
      const field = gooCoverage(
        [
          { cx: 100 - gap / 2, cy: 50, r: 30 },
          { cx: 100 + gap / 2, cy: 50, r: 30 },
        ],
        grid,
        0.5
      );

      return field.subarray(50 * 200, 51 * 200);
    };

    expect(row(70)[100]).toBeGreaterThan(0.5);
    expect(row(110)[100]).toBe(0);
    expect(Array.from(row(110)).some((value) => value > 0.05 && value < 0.95)).toBe(true);
  });
});
