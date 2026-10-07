// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { BackgroundLayer, ImageOverlay } from '../templateEditorModel';
import { animationVisibilityAt, imageVisibilityAt, layerVisibilityAt } from './element-visibility.logic';

const image = (extra: Partial<ImageOverlay> = {}): ImageOverlay => ({
  id: 'i1',
  choice: { source: 'library', id: 'logo' },
  ...extra,
});

describe('imageVisibilityAt', () => {
  it('rests when the image has no window and no motion', () => {
    const vis = imageVisibilityAt(image(), 2, 6);

    expect(vis.opacity).toBe(1);
    expect(vis.translateX).toBe(0);
    expect(vis.translateY).toBe(0);
  });

  it('hides before the show window opens and after it closes', () => {
    const timed = image({ start: 2, end: 4 });

    expect(imageVisibilityAt(timed, 1.5, 6).opacity).toBe(0);
    expect(imageVisibilityAt(timed, 3, 6).opacity).toBe(1);
    expect(imageVisibilityAt(timed, 4.5, 6).opacity).toBe(0);
  });

  it('an unset/zero bound means unbounded on that side', () => {
    expect(imageVisibilityAt(image({ end: 4 }), 0.1, 6).opacity).toBe(1);
    expect(imageVisibilityAt(image({ start: 0 }), 0.1, 6).opacity).toBe(1);
  });

  it('samples the motion reveal on the scene clock (delay is scene-relative, like the engine)', () => {
    const moving = image({ motion: { type: 'rise', delay: 1, duration: 1 } });

    // before the delay: hidden and offset.
    expect(imageVisibilityAt(moving, 0.5, 6).opacity).toBe(0);
    // mid-entrance: partially revealed, still travelling.
    const mid = imageVisibilityAt(moving, 1.5, 6);
    expect(mid.opacity).toBeGreaterThan(0);
    expect(mid.opacity).toBeLessThan(1);
    expect(mid.translateY).toBeGreaterThan(0);
    // settled.
    expect(imageVisibilityAt(moving, 3, 6)).toMatchObject({ opacity: 1, translateY: 0 });
  });

  it('the show window wins over the motion (hidden even mid-entrance)', () => {
    const both = image({ start: 2, motion: { type: 'fade', delay: 0, duration: 1 } });

    expect(imageVisibilityAt(both, 1, 6).opacity).toBe(0);
  });
});

describe('layerVisibilityAt', () => {
  const gradient: BackgroundLayer = { gradient: { from: '#000', to: '#fff' }, reveal: 'fade' };
  const solid: BackgroundLayer = { color: '#112233', reveal: 'fade' };

  it('rests without a reveal', () => {
    expect(layerVisibilityAt({ color: '#112233' }, 0, 5).opacity).toBe(1);
    expect(layerVisibilityAt({ color: '#112233', reveal: 'none' }, 0, 5).opacity).toBe(1);
  });

  it('a gradient layer fades in like an overlay reveal', () => {
    expect(layerVisibilityAt(gradient, 0.1, 5).opacity).toBe(0);
    const mid = layerVisibilityAt(gradient, 0.6, 5);
    expect(mid.opacity).toBeGreaterThan(0);
    expect(mid.opacity).toBeLessThan(1);
    expect(layerVisibilityAt(gradient, 2, 5).opacity).toBe(1);
  });

  it('a solid layer POPS at the delay (drawbox timeline gate — no alpha ramp)', () => {
    expect(layerVisibilityAt(solid, 0.29, 5).opacity).toBe(0);
    expect(layerVisibilityAt(solid, 0.31, 5)).toMatchObject({ opacity: 1, translateX: 0, translateY: 0 });
  });

  it('a solid layer honours an authored delay', () => {
    const late: BackgroundLayer = { color: '#112233', reveal: { type: 'rise', delay: 1.5 } };

    expect(layerVisibilityAt(late, 1.4, 5).opacity).toBe(0);
    expect(layerVisibilityAt(late, 1.6, 5).opacity).toBe(1);
  });
});

describe('animationVisibilityAt', () => {
  it('shows a file from its start for its duration, or holds it when persistent', () => {
    const file = { start: 1, duration: 2 };

    expect(animationVisibilityAt(file, 0.5, 6).opacity).toBe(0);
    expect(animationVisibilityAt(file, 2, 6).opacity).toBe(1);
    expect(animationVisibilityAt(file, 3.5, 6).opacity).toBe(0);
    expect(animationVisibilityAt({ ...file, persistent: true }, 3.5, 6).opacity).toBe(1);
    expect(animationVisibilityAt({}, 5, 6).opacity).toBe(1);
  });
});
