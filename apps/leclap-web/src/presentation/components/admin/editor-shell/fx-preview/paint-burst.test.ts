// The burst preview samples the engine's plan the way the render's expressions do: each ray runs from the
// inner to the outer radius as a trim path and fades out over its tail.
import { describe, expect, it } from 'vitest';
import type { Graphic } from 'ffmpeg-video-composer/src/schemas/graphics.schemas.ts';
import type { FxContext } from 'ffmpeg-video-composer/src/editor/presets/fx-kit.ts';
import { planOf } from 'ffmpeg-video-composer/src/editor/presets/fx-burst.ts';
import { newSection, type EditorSection } from '../../templateEditorModel';
import { previewFxContext, type PreviewEnv } from './fx-context';
import { rayAt } from './paint-burst';
import { preparePainter } from './prepare';

const env: PreviewEnv = {
  orientation: 'landscape',
  section: {
    ...newSection('color'),
    layers: [{ color: '#141416' }, { color: '#f96f99', x: 580, y: 300, w: 120, h: 120 }],
  } as EditorSection,
  sectionIndex: 0,
  sectionSeconds: 3,
  reduced: false,
};
const graphic = { type: 'fx', effect: 'burst', target: 'layer:1', at: 0.5, jitter: 0, ease: 'linear' } as Graphic;

describe('burst preview', () => {
  it('prepares a painter over the effect window', () => {
    const painter = preparePainter(graphic, 0, env);

    expect(painter?.paint).toBeTypeOf('function');
    expect(painter?.span[0]).toBeLessThanOrEqual(0.5);
  });

  it('shoots each ray from its inner radius out to its outer radius, then fades it', () => {
    const fx = previewFxContext(graphic, 0, env) as unknown as FxContext<'burst'>;
    const ray = planOf(fx)?.rays[0];
    const linear = (p: number) => p;

    if (!ray) throw new Error('no ray');

    const born = rayAt(linear, ray, ray.start, 1 / 30);
    const mid = rayAt(linear, ray, ray.start + ray.life * 0.5, 1 / 30);
    const last = rayAt(linear, ray, ray.start + ray.life, 1 / 30);

    expect(born?.alpha).toBe(0);
    expect(born?.from).toBeLessThanOrEqual(ray.inner);
    expect(mid?.share).toBe(1);
    expect(mid?.alpha).toBeGreaterThan(0.5);
    expect(last?.to).toBeCloseTo(ray.outer + (ray.length * 0.3) / 2, 6);
    expect(last?.alpha).toBe(0);
    expect(rayAt(linear, ray, ray.start + ray.life + 0.1, 1 / 30)).toBeNull();
  });
});
