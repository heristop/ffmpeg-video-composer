import { describe, expect, it } from 'vitest';
import type { Graphic } from '@/schemas/graphics.schemas';
import type { PathCommand } from '@/editor/presets/path-geometry';
import { parseSvgPath } from '@/editor/presets/path-svg';
import { graphicTiming, graphicToFilters } from '@/editor/presets/graphics';
import {
  placementBox,
  presetCommands,
  shapeBounds,
  shapeOutline,
  svgPathText,
  viewBoxCommands,
} from '@/editor/presets/shape-geometry';

const LANDSCAPE = { width: 1280, height: 720, fps: 30 };
const PORTRAIT = { width: 720, height: 1280, fps: 30 };

// The on-curve vertices of a polygonal outline (the M and L ends).
function vertices(commands: PathCommand[] | null): Array<{ x: number; y: number }> {
  return (commands ?? [])
    .filter((c) => c[0] === 'M' || c[0] === 'L')
    .map((c) => ({ x: c[1] as number, y: c[2] as number }));
}

describe('placementBox', () => {
  it('centres a square of 40 % of the short side when nothing is placed, in any format', () => {
    expect(placementBox({}, LANDSCAPE, null)).toEqual({ x: 496, y: 216, w: 288, h: 288 });
    expect(placementBox({}, PORTRAIT, null)).toEqual({ x: 216, y: 496, w: 288, h: 288 });
  });

  it('reads x, y, width and height as fractions of the target and centres what is not placed', () => {
    const target = { x: 100, y: 80, w: 300, h: 200 };

    expect(placementBox({ x: 0.5, y: 0.25, width: 0.5, height: 0.5 }, LANDSCAPE, target)).toEqual({
      x: 250,
      y: 130,
      w: 150,
      h: 100,
    });
    expect(placementBox({ width: 0.5 }, LANDSCAPE, target)).toEqual({ x: 175, y: 130, w: 150, h: 100 });
  });
});

describe('presetCommands', () => {
  it('keeps a star regular inside a wide box: tips on one circle about the box centre, first tip up', () => {
    const star = presetCommands({ type: 'star', points: 5, inner: 0.4 }, { x: 0, y: 0, w: 400, h: 200 }, 0);
    const points = vertices(star);

    expect(points).toHaveLength(10);
    expect(star.at(-1)).toEqual(['Z']);
    for (const [i, p] of points.entries()) {
      expect(Math.hypot(p.x - 200, p.y - 100)).toBeCloseTo(i % 2 === 0 ? 100 : 40, 6);
    }
    expect(points[0].x).toBeCloseTo(200, 6);
    expect(points[0].y).toBeCloseTo(0, 6);
  });

  it('keeps a star regular on a portrait frame when it is placed in fractions of the frame', () => {
    const frameTarget = { x: 0, y: 0, w: 720, h: 1280 };
    const commands = shapeOutline({ preset: { type: 'star' }, width: 0.5, height: 0.5 }, PORTRAIT, frameTarget, 0);
    const tips = vertices(commands).filter((_, i) => i % 2 === 0);

    expect(tips).toHaveLength(5);
    for (const p of tips) expect(Math.hypot(p.x - 360, p.y - 640)).toBeCloseTo(180, 6);
  });

  it('draws a regular polygon with its first corner up', () => {
    const hexagon = vertices(presetCommands({ type: 'polygon', sides: 6 }, { x: 0, y: 0, w: 100, h: 100 }, 0));

    expect(hexagon).toHaveLength(6);
    for (const p of hexagon) expect(Math.hypot(p.x - 50, p.y - 50)).toBeCloseTo(50, 6);
    expect(hexagon[0].y).toBeCloseTo(0, 6);
  });

  it('fits the heart in the centred square of the box', () => {
    const bounds = shapeBounds(presetCommands({ type: 'heart' }, { x: 0, y: 0, w: 300, h: 200 }, 0), 0);

    expect(bounds).toEqual(expect.objectContaining({ x: expect.any(Number), w: expect.any(Number) }));

    const { x, y, w, h } = bounds as { x: number; y: number; w: number; h: number };

    expect(x).toBeCloseTo(50, 6);
    expect(y).toBeCloseTo(0, 6);
    expect(w).toBeCloseTo(200, 6);
    expect(h).toBeCloseTo(200, 6);
  });

  it('points an arrow where asked, filling the box', () => {
    const up = vertices(presetCommands({ type: 'arrow', direction: 'up' }, { x: 0, y: 0, w: 100, h: 200 }, 0));

    expect(up).toHaveLength(7);
    expect(up.some((p) => Math.abs(p.x - 50) < 1e-9 && Math.abs(p.y) < 1e-9)).toBe(true);
  });

  it('draws the same blob for the same seed and another one for another seed', () => {
    const box = { x: 0, y: 0, w: 200, h: 200 };
    const a = presetCommands({ type: 'blob', seed: 3 }, box, 0);

    expect(presetCommands({ type: 'blob', seed: 3 }, box, 99)).toEqual(a);
    expect(presetCommands({ type: 'blob', seed: 4 }, box, 0)).not.toEqual(a);
    expect(presetCommands({ type: 'blob' }, box, 3)).toEqual(a);
    expect(a[0][0]).toBe('M');
    expect(a.at(-1)).toEqual(['Z']);
    expect(a.filter((c) => c[0] === 'C')).toHaveLength(6);
  });

  it('rounds a rect into a pill at radius 0.5', () => {
    const pill = presetCommands({ type: 'rect', radius: 0.5 }, { x: 0, y: 0, w: 200, h: 100 }, 0);

    expect(pill[0]).toEqual(['M', 50, 0]);
    expect(pill.filter((c) => c[0] === 'C')).toHaveLength(4);
    expect(shapeBounds(pill, 0)).toEqual({ x: 0, y: 0, w: 200, h: 100 });
  });
});

describe('shapeOutline from a d', () => {
  it('maps a viewBox into the box, keeping its proportions, centred', () => {
    const commands = viewBoxCommands(parseSvgPath('M0 0 L24 0 L24 24 Z') ?? [], [0, 0, 24, 24], {
      x: 10,
      y: 20,
      w: 100,
      h: 50,
    });

    expect(commands).toEqual([['M', 35, 20], ['L', 85, 20], ['L', 85, 70], ['Z']]);
  });

  it('keeps px without a target and reads fractions of the target like the path graphic', () => {
    expect(shapeOutline({ d: 'M10 10 L50 10 L50 40 Z' }, LANDSCAPE, null, 0)).toEqual([
      ['M', 10, 10],
      ['L', 50, 10],
      ['L', 50, 40],
      ['Z'],
    ]);
    expect(shapeOutline({ d: 'M0 0 L1 0 L1 1 Z' }, LANDSCAPE, { x: 100, y: 80, w: 300, h: 200 }, 0)).toEqual([
      ['M', 100, 80],
      ['L', 400, 80],
      ['L', 400, 280],
      ['Z'],
    ]);
  });

  it('returns null for a d the parser refuses', () => {
    expect(shapeOutline({ d: 'M0 0 A1 1 0 0 0 1 1' }, LANDSCAPE, null, 0)).toBeNull();
  });
});

describe('shapeBounds and svgPathText', () => {
  it('grows the outline box by half the stroke', () => {
    expect(shapeBounds(parseSvgPath('M10 10 L110 10 L110 60 Z') ?? [], 8)).toEqual({ x: 6, y: 6, w: 108, h: 58 });
  });

  it('writes commands back as an SVG d the path parser reads to the same points (2 decimals)', () => {
    const heart = presetCommands({ type: 'heart' }, { x: 10, y: 10, w: 100, h: 100 }, 0);
    const rounded = heart.map((c) => c.map((v) => (typeof v === 'number' ? Number(v.toFixed(2)) : v)));

    expect(parseSvgPath(svgPathText(heart))).toEqual(rounded);
  });
});

describe('the shape in the graphics table', () => {
  it('reports its timing and resting footprint for the motion timeline', () => {
    const timing = graphicTiming({ type: 'shape', preset: { type: 'star' } } as Graphic, LANDSCAPE);

    expect(timing.duration).toBe(0.4);
    expect(timing.bbox?.x).toBeCloseTo(503.05, 1);
    expect(timing.bbox?.y).toBeCloseTo(216, 6);
    expect(
      graphicTiming({ type: 'shape', preset: { type: 'heart' }, stroke: { draw: true } } as Graphic, LANDSCAPE).duration
    ).toBe(1.2);
  });

  it('draws nothing without the compile-path lowering (validation, timelines)', () => {
    const section = { name: 's', type: 'color_background', options: { duration: 3 } } as never;
    const ctx = { duration: 3, scale: '1280:720', fps: 30, isVideo: false };

    expect(
      graphicToFilters({ type: 'shape', preset: { type: 'star' } } as Graphic, LANDSCAPE, {
        seed: 0,
        site: { section, ctx, index: 0 },
      })
    ).toEqual([]);
  });
});
