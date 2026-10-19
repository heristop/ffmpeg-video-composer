import { describe, expect, it } from 'vitest';
import {
  featherPad,
  maskShapeCommands,
  placeCommands,
  placeMask,
  translateCommands,
} from '@/editor/presets/mask-shape';

describe('mask shapes as commands', () => {
  it('draws a square rect as four lines and caps a corner radius at half the shorter side', () => {
    expect(maskShapeCommands({ type: 'rect', x: 10, y: 20, w: 30, h: 40 })).toEqual([
      ['M', 10, 20],
      ['L', 40, 20],
      ['L', 40, 60],
      ['L', 10, 60],
      ['Z'],
    ]);
    expect(maskShapeCommands({ type: 'rect', x: 0, y: 0, w: 100, h: 40, radius: 50 })?.[0]).toEqual(['M', 20, 0]);
  });

  it('draws an ellipse as one full arc and a path through the path graphic parser', () => {
    expect(maskShapeCommands({ type: 'ellipse', cx: 320, cy: 180, rx: 50, ry: 30 })).toEqual([
      ['E', 320, 180, 50, 30, 0, 360],
    ]);
    expect(maskShapeCommands({ type: 'path', d: 'M10 10 l20 0 l0 20 z' })).toEqual([
      ['M', 10, 10],
      ['L', 30, 10],
      ['L', 30, 30],
      ['Z'],
    ]);
    expect(maskShapeCommands({ type: 'path', d: 'M0 0 L' })).toBeNull();
  });

  it('moves coordinate pairs, and only the centre of an arc', () => {
    expect(translateCommands([['M', 1, 2], ['E', 10, 10, 5, 5, 0, 360], ['Z']], 3, -2)).toEqual([
      ['M', 4, 0],
      ['E', 13, 8, 5, 5, 0, 360],
      ['Z'],
    ]);
  });
});

describe('placeMask', () => {
  it('refuses a `d` longer than MAX_D itself, whether or not the caller validated it', () => {
    const d = `M0 0${' L10 0 L10 10'.repeat(400)} Z`;

    expect(d.length).toBeGreaterThan(4000);
    expect(placeMask({ type: 'path', d })).toMatchObject({ ok: false, code: 'mask_path_invalid' });
    expect(placeMask({ type: 'path', d: 'M0 0 L10 0 L10 10 Z' }).ok).toBe(true);
  });

  it('places the image over the shape plus one pixel, the path relative to it', () => {
    expect(placeMask({ type: 'rect', x: 100, y: 50, w: 200, h: 100 })).toEqual({
      ok: true,
      mask: { x: 99, y: 49, w: 202, h: 102, feather: 0, path: 'M1_1L201_1L201_101L1_101Z' },
    });
  });

  it('pads a feathered mask so its soft edge is never cut', () => {
    const placed = placeMask({ type: 'rect', x: 100, y: 50, w: 200, h: 100 }, 10);

    expect(featherPad(10)).toBe(13);
    expect(placed.ok && placed.mask).toMatchObject({ x: 87, y: 37, w: 226, h: 126, feather: 10 });
  });

  it('bounds an ellipse by its flattened outline', () => {
    const placed = placeMask({ type: 'ellipse', cx: 320, cy: 180, rx: 50, ry: 30 });

    expect(placed.ok && placed.mask).toMatchObject({ x: 269, y: 149, w: 102, h: 62 });
  });

  it('refuses a shape without area and a malformed path', () => {
    expect(placeMask({ type: 'path', d: 'M0 0 L10 0' })).toMatchObject({ ok: false, code: 'mask_path_invalid' });
    expect(placeMask({ type: 'path', d: 'M0 0 L' })).toMatchObject({ ok: false, code: 'mask_path_invalid' });
  });

  it('refuses oversized and exploding shapes quickly, and fills a long legitimate path', () => {
    const start = performance.now();

    expect(placeMask({ type: 'rect', x: 0, y: 0, w: 5000, h: 100 })).toMatchObject({
      ok: false,
      code: 'mask_too_large',
    });
    expect(placeMask({ type: 'path', d: 'M0 0 L1e9 0 L0 1 Z' })).toMatchObject({
      ok: false,
      code: 'mask_too_large',
    });
    expect(placeMask({ type: 'path', d: `M0 0${'L4000 1L0 2'.repeat(360)}` }).ok).toBe(true);
    expect(placeMask({ type: 'path', d: `M0 0${'L1 1L0 0'.repeat(495)}L50 50L0 50Z` }).ok).toBe(true);
    expect(performance.now() - start).toBeLessThan(250);
  });
});

describe('placeCommands on untrusted commands', () => {
  it('refuses a wave of wavelength 0 instead of placing NaN points', () => {
    expect(placeCommands([['W', 0, 0, 100, 10, 0, 0], ['Z']])).toMatchObject({ ok: false, code: 'mask_path_invalid' });
  });

  it('refuses non-finite coordinates', () => {
    const lines: Parameters<typeof placeCommands>[0] = [['M', 0, 0], ['L', Number.NaN, 5], ['L', 0, 9], ['Z']];

    expect(placeCommands(lines)).toMatchObject({ ok: false, code: 'mask_path_invalid' });
  });

  it('refuses an ellipse or a curve run that would flatten past the point budget', () => {
    const start = performance.now();
    const curves: Parameters<typeof placeCommands>[0] = Array.from({ length: 400 }, () => [
      'C',
      0,
      4000,
      4000,
      0,
      0,
      8,
    ]);

    expect(placeCommands([['E', 0, 0, 1e7, 1e7, 0, 360]])).toMatchObject({ ok: false, code: 'mask_too_large' });
    expect(placeCommands([['M', 0, 0], ...curves, ['Z']])).toMatchObject({ ok: false, code: 'mask_path_invalid' });
    expect(performance.now() - start).toBeLessThan(250);
  });
});
