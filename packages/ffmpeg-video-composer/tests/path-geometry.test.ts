import { describe, expect, it } from 'vitest';
import { catmullRom, flatten, pointAt, shapeCommands, traceOf, type PathCommand } from '@/editor/presets/path-geometry';
import { decodeCommands, encodeCommands, parseSvgPath } from '@/editor/presets/path-svg';

const near = (a: number, b: number, eps = 0.5) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);

describe('path geometry: arc length', () => {
  it('measures a polyline and samples it by arc length', () => {
    const traced = traceOf(
      flatten([
        ['M', 0, 0],
        ['L', 300, 0],
        ['L', 300, 100],
      ])
    );

    expect(traced.total).toBeCloseTo(400, 6);
    expect(pointAt(traced, 0)).toEqual({ x: 0, y: 0 });
    expect(pointAt(traced, 0.5)).toEqual({ x: 200, y: 0 });
    expect(pointAt(traced, 0.875)).toEqual({ x: 300, y: 50 });
    expect(pointAt(traced, 1)).toEqual({ x: 300, y: 100 });
    // Out of range clamps to the ends.
    expect(pointAt(traced, 1.5)).toEqual({ x: 300, y: 100 });
  });

  it('does not count the pen-up jump between subpaths', () => {
    const traced = traceOf(
      flatten([
        ['M', 0, 0],
        ['L', 100, 0],
        ['M', 0, 50],
        ['L', 100, 50],
      ])
    );

    expect(traced.subpaths).toHaveLength(2);
    expect(traced.total).toBeCloseTo(200, 6);
    expect(pointAt(traced, 0.75)).toEqual({ x: 50, y: 50 });
  });
});

describe('path geometry: shapes', () => {
  it('a circle starts at 12 o’clock, runs clockwise and measures 2πr', () => {
    const traced = traceOf(flatten(shapeCommands({ type: 'circle', cx: 200, cy: 150, r: 100 })));

    near(traced.total, 2 * Math.PI * 100, 0.2);
    near(pointAt(traced, 0).x, 200);
    near(pointAt(traced, 0).y, 50);
    // A quarter turn clockwise on screen (y down) is 3 o'clock.
    near(pointAt(traced, 0.25).x, 300);
    near(pointAt(traced, 0.25).y, 150);
    near(pointAt(traced, 0.5).y, 250);
    near(pointAt(traced, 1).x, 200);
    near(pointAt(traced, 1).y, 50);
  });

  it('ccw circles and arcs run the other way', () => {
    const ccw = traceOf(flatten(shapeCommands({ type: 'circle', cx: 0, cy: 0, r: 50, direction: 'ccw' })));
    const arc = traceOf(flatten(shapeCommands({ type: 'arc', cx: 0, cy: 0, r: 50, start: 0, sweep: -90 })));

    near(pointAt(ccw, 0.25).x, -50);
    near(arc.total, (Math.PI / 2) * 50, 0.1);
    near(pointAt(arc, 1).x, 0);
    near(pointAt(arc, 1).y, -50);
  });

  it('an ellipse passes through its four extremes', () => {
    const traced = traceOf(flatten(shapeCommands({ type: 'ellipse', cx: 0, cy: 0, rx: 200, ry: 50, start: 0 })));
    const xs = traced.subpaths[0].map((p) => p.x);
    const ys = traced.subpaths[0].map((p) => p.y);

    near(Math.max(...xs), 200);
    near(Math.min(...xs), -200);
    near(Math.max(...ys), 50);
    near(Math.min(...ys), -50);
  });

  it('a wave rises first from its baseline and spans its width', () => {
    const traced = traceOf(
      flatten(shapeCommands({ type: 'wave', x: 100, y: 300, width: 400, amplitude: 40, wavelength: 200 }))
    );
    const points = traced.subpaths[0];

    expect(points[0]).toEqual({ x: 100, y: 300 });
    near(points.at(-1)!.x, 500, 1e-6);
    // A quarter wavelength in: the crest, 40 px above the baseline (y up is negative).
    const crest = points.reduce((best, p) => (p.y < best.y ? p : best));
    near(crest.y, 260, 0.2);
    near(crest.x, 150, 2);
    expect(traced.total).toBeGreaterThan(400);
  });
});

describe('path geometry: smoothing', () => {
  it('passes through every control point and stays near the polyline', () => {
    const points = [
      { x: 0, y: 100 },
      { x: 100, y: 0 },
      { x: 200, y: 100 },
      { x: 300, y: 0 },
    ];
    const commands = catmullRom(points, false);
    const flat = flatten(commands)[0];

    expect(commands[0]).toEqual(['M', 0, 100]);
    expect(commands.slice(1).every((c) => c[0] === 'C')).toBe(true);

    for (const p of points) {
      const nearest = Math.min(...flat.map((q) => Math.hypot(q.x - p.x, q.y - p.y)));
      expect(nearest).toBeLessThan(1e-6);
    }

    // Smooth: no sharp corner at an interior control point (the tangent turns little per flattened step).
    const turns = flat.slice(1, -1).map((p, i) => {
      const [a, b] = [flat[i], flat[i + 2]];
      const u = Math.atan2(p.y - a.y, p.x - a.x);
      const v = Math.atan2(b.y - p.y, b.x - p.x);

      return Math.abs(Math.atan2(Math.sin(v - u), Math.cos(v - u)));
    });
    expect(Math.max(...turns)).toBeLessThan(0.35);
  });

  it('closes a smooth loop back on its first point', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const flat = flatten(catmullRom(square, true))[0];

    expect(flat[0]).toEqual(flat.at(-1));
  });

  it('survives repeated points (no NaN)', () => {
    const flat = flatten(
      catmullRom(
        [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 50, y: 50 },
        ],
        false
      )
    )[0];

    expect(flat.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });
});

describe('path geometry: SVG d', () => {
  it('parses absolute and relative M/L/H/V/C/Q/Z', () => {
    expect(parseSvgPath('M10 20 L30 20 h10 v-5 l-10,0 Z')).toEqual([
      ['M', 10, 20],
      ['L', 30, 20],
      ['L', 40, 20],
      ['L', 40, 15],
      ['L', 30, 15],
      ['Z'],
    ]);
    expect(parseSvgPath('m0 0 c10 0 20 10 20 20 q0 10 -10 10')).toEqual([
      ['M', 0, 0],
      ['C', 10, 0, 20, 10, 20, 20],
      ['Q', 20, 30, 10, 30],
    ]);
    // Implicit lineto after a moveto, and exponent numbers.
    expect(parseSvgPath('M0,0 10,0 1e1,1e1')).toEqual([
      ['M', 0, 0],
      ['L', 10, 0],
      ['L', 10, 10],
    ]);
  });

  it('rejects unsupported commands and malformed paths', () => {
    expect(parseSvgPath('M0 0 A10 10 0 0 1 20 20')).toBeNull();
    expect(parseSvgPath('L0 0')).toBeNull();
    expect(parseSvgPath('M0 0 L10')).toBeNull();
  });

  it('a quadratic and a cubic flatten onto their exact end points', () => {
    const traced = traceOf(flatten(parseSvgPath('M0 0 Q50 100 100 0 C100 50 200 50 200 0')!));
    const flat = traced.subpaths[0];

    expect(flat.some((p) => p.x === 100 && p.y === 0)).toBe(true);
    expect(flat.at(-1)).toEqual({ x: 200, y: 0 });
    // The quadratic's apex is at y = 50 (half its control height).
    near(Math.max(...flat.filter((p) => p.x <= 100).map((p) => p.y)), 50, 0.1);
  });
});

describe('path geometry: encoding', () => {
  it('round-trips commands through the compact form used in trace: URLs', () => {
    const commands: PathCommand[] = [
      ['M', 10.125, -20],
      ['C', 1, 2, 3, 4, 5, 6],
      ['Q', 1, 2, 3, 4],
      ['E', 100, 100, 50, 40, -90, 360],
      ['W', 0, 300, 400, 40, 200, 0],
      ['L', 7, 8],
      ['Z'],
    ];
    const text = encodeCommands(commands);

    expect(text).not.toMatch(/[\s,{}]/);
    expect(decodeCommands(text)).toEqual(commands);
    expect(decodeCommands('M1_2X3')).toBeNull();
  });

  it('is deterministic: the same commands flatten to the same points', () => {
    const shape = shapeCommands({ type: 'wave', x: 0, y: 0, width: 999, amplitude: 33, wavelength: 140, phase: 30 });

    expect(JSON.stringify(flatten(shape))).toBe(JSON.stringify(flatten(shape)));
  });
});
