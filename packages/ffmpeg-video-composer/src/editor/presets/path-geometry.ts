// The maths of the path graphic (graphics[].type "path"): every way of describing a path (points, a smooth
// curve through them, a circle / ellipse / arc / wave, an SVG `d`) becomes one canonical command list in
// frame px, which flattens to polylines (≤ 1.5 px steps) measured by arc length. The rasteriser
// (path-raster.ts) and the lowering (path-draw.ts) both start from the same commands, so the stroke image
// and the head that rides it agree. Pure functions of their input; no randomness, no platform APIs.

import type { z } from 'zod';
import type { PathShapeSchema } from '../../schemas/graphics-path.schemas';

export interface Pt {
  x: number;
  y: number;
}

/**
 * Canonical commands (absolute px): M/L/C/Q/Z as in SVG, plus E (elliptical arc: cx, cy, rx, ry, start°,
 * sweep°, clockwise on screen when positive) and W (sine wave: x, baseline y, width, amplitude, wavelength,
 * phase°). E and W start a new subpath unless the pen already sits on their first point.
 */
export type PathCommand =
  | ['M' | 'L', number, number]
  | ['C', number, number, number, number, number, number]
  | ['Q', number, number, number, number]
  | ['E' | 'W', number, number, number, number, number, number]
  | ['Z'];

export type PathShape = z.infer<typeof PathShapeSchema>;

/** Polylines with their cumulative arc length; pen-up jumps between subpaths do not count. */
export interface Traced {
  subpaths: Pt[][];
  /** cum[i][j]: arc length from the path start to subpaths[i][j]. */
  cum: number[][];
  /** Total arc length in px. */
  total: number;
}

const STEP = 1.5;
const MAX_STEPS = 4096;
const RAD = Math.PI / 180;

function steps(length: number, min = 1): number {
  return Math.min(MAX_STEPS, Math.max(min, Math.ceil(length / STEP)));
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

// ── flattening ─────────────────────────────────────────────────────────────────

function ellipsePoint(c: number[], k: number, n: number): Pt {
  const [cx, cy, rx, ry, start, sweep] = c;
  const theta = (start + (sweep * k) / n) * RAD;

  return { x: cx + rx * Math.cos(theta), y: cy + ry * Math.sin(theta) };
}

function ellipse(c: number[]): Pt[] {
  const [, , rx, ry, , sweep] = c;
  const n = steps(Math.abs(sweep * RAD) * Math.max(rx, ry), 4);

  return Array.from({ length: n + 1 }, (_, k) => ellipsePoint(c, k, n));
}

function wavePoint(c: number[], x: number): Pt {
  const [x0, y0, , amplitude, wavelength, phase] = c;

  return { x, y: y0 - amplitude * Math.sin((2 * Math.PI * (x - x0)) / wavelength + phase * RAD) };
}

function wave(c: number[]): Pt[] {
  const [x0, , width, amplitude, wavelength] = c;
  const n = steps(width * (1 + (2 * Math.PI * amplitude) / wavelength), 8);

  return Array.from({ length: n + 1 }, (_, k) => wavePoint(c, k === n ? x0 + width : x0 + (width * k) / n));
}

function cubic(p0: Pt, c: number[]): Pt[] {
  const [p1, p2, p3] = [
    { x: c[0], y: c[1] },
    { x: c[2], y: c[3] },
    { x: c[4], y: c[5] },
  ];
  const n = steps(dist(p0, p1) + dist(p1, p2) + dist(p2, p3));

  return Array.from({ length: n }, (_, i) => {
    const t = (i + 1) / n;
    const u = 1 - t;
    const [a, b, d, e] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];

    return i === n - 1
      ? p3
      : { x: a * p0.x + b * p1.x + d * p2.x + e * p3.x, y: a * p0.y + b * p1.y + d * p2.y + e * p3.y };
  });
}

function quadratic(p0: Pt, c: number[]): Pt[] {
  const [p1, p2] = [
    { x: c[0], y: c[1] },
    { x: c[2], y: c[3] },
  ];
  const n = steps(dist(p0, p1) + dist(p1, p2));

  return Array.from({ length: n }, (_, i) => {
    const t = (i + 1) / n;
    const u = 1 - t;

    return i === n - 1
      ? p2
      : { x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y };
  });
}

class Pen {
  readonly done: Pt[][] = [];
  current: Pt[] = [];
  start: Pt = { x: 0, y: 0 };

  private flushed = 0;

  /** Points held so far (finished subpaths plus the open one). */
  get count(): number {
    return this.flushed + this.current.length;
  }

  last(): Pt {
    return this.current.at(-1) ?? this.start;
  }

  moveTo(p: Pt): void {
    this.flush();
    this.start = p;
    this.current = [p];
  }

  // Draw from the pen: begin at the current point after a moveto or close.
  lineTo(points: Pt[]): void {
    if (this.current.length === 0) this.current = [this.start];

    this.current.push(...points);
  }

  // A shape with its own first point: joins the pen when it already sits there, else starts a subpath.
  shape(points: Pt[]): void {
    const [first] = points;

    if (this.current.length === 0 || dist(this.last(), first) > 1e-6) this.moveTo(first);

    this.lineTo(points.slice(1));
  }

  close(): void {
    const first = this.current[0];

    if (this.current.length > 1 && dist(this.last(), first) > 1e-9) this.current.push(first);

    this.flush();
  }

  flush(): void {
    if (this.current.length > 1) {
      this.done.push(this.current);
      this.flushed += this.current.length;
    }

    if (this.current.length > 0) this.start = this.current[0];

    this.current = [];
  }
}

/** The commands as polylines (one per subpath, ≥ 2 points each). */
export function flatten(commands: readonly PathCommand[]): Pt[][] {
  return flattenWithin(commands, Infinity) as Pt[][];
}

/** `flatten`, but null as soon as the polylines pass `maxPoints` points, so untrusted paths never grow past it. */
export function flattenWithin(commands: readonly PathCommand[], maxPoints: number): Pt[][] | null {
  const pen = new Pen();

  for (const command of commands) {
    if (pen.count > maxPoints) return null;

    const [kind, ...c] = command as [string, ...number[]];

    if (kind === 'M') pen.moveTo({ x: c[0], y: c[1] });

    if (kind === 'L') pen.lineTo([{ x: c[0], y: c[1] }]);

    if (kind === 'C') pen.lineTo(cubic(pen.last(), c));

    if (kind === 'Q') pen.lineTo(quadratic(pen.last(), c));

    if (kind === 'E') pen.shape(ellipse(c));

    if (kind === 'W') pen.shape(wave(c));

    if (kind === 'Z') pen.close();
  }

  pen.flush();

  return pen.count > maxPoints ? null : pen.done;
}

// ── arc length ─────────────────────────────────────────────────────────────────

export function traceOf(subpaths: Pt[][]): Traced {
  let total = 0;
  const cum = subpaths.map((points) =>
    points.map((p, j) => {
      total += j === 0 ? 0 : dist(points[j - 1], p);

      return total;
    })
  );

  return { subpaths, cum, total };
}

function pointOnSubpath(points: Pt[], cum: number[], target: number): Pt | undefined {
  for (let j = 1; j < points.length; j++) {
    if (target > cum[j] && j < points.length - 1) continue;

    const span = cum[j] - cum[j - 1];
    const u = span > 0 ? Math.min(1, Math.max(0, (target - cum[j - 1]) / span)) : 1;
    const [a, b] = [points[j - 1], points[j]];

    return u === 1 ? b : { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
  }

  return undefined;
}

/** The point at `fraction` (0..1, clamped) of the path's length. */
export function pointAt(traced: Traced, fraction: number): Pt {
  const target = Math.min(1, Math.max(0, fraction)) * traced.total;

  for (const [i, points] of traced.subpaths.entries()) {
    const cum = traced.cum[i];

    if (target > (cum.at(-1) as number) && i < traced.subpaths.length - 1) continue;

    const point = pointOnSubpath(points, cum, target);

    if (point) return point;
  }

  return traced.subpaths.at(-1)?.at(-1) ?? { x: 0, y: 0 };
}

// ── sources → commands ─────────────────────────────────────────────────────────

const CR_EPS = 1e-9;

// The Bézier controls of the centripetal Catmull-Rom segment p1 → p2 (α = 0.5).
function controls(p0: Pt, p1: Pt, p2: Pt, p3: Pt): [Pt, Pt] {
  const d2 = dist(p1, p2);
  const d1 = dist(p0, p1) > CR_EPS ? dist(p0, p1) : d2;
  const d3 = dist(p2, p3) > CR_EPS ? dist(p2, p3) : d2;
  const [r1, r2, r3] = [Math.sqrt(d1), Math.sqrt(d2), Math.sqrt(d3)];
  const a = 2 * d1 + 3 * r1 * r2 + d2;
  const b = 2 * d3 + 3 * r3 * r2 + d2;
  const [na, nb] = [3 * r1 * (r1 + r2), 3 * r3 * (r3 + r2)];

  return [combine([p2, d1 / na], [p0, -d2 / na], [p1, a / na]), combine([p1, d3 / nb], [p3, -d2 / nb], [p2, b / nb])];
}

// Σ weight × point.
function combine(...terms: Array<[Pt, number]>): Pt {
  return terms.reduce((sum, [p, k]) => ({ x: sum.x + k * p.x, y: sum.y + k * p.y }), { x: 0, y: 0 });
}

function reflect(a: Pt, b: Pt): Pt {
  return { x: 2 * a.x - b.x, y: 2 * a.y - b.y };
}

// Point i of the control polygon: wrapped round a closed loop, reflected past the ends of an open one.
function controlPoint(points: readonly Pt[], i: number, closed: boolean): Pt {
  const n = points.length;

  if (closed) return points[(i + n) % n];

  if (i < 0) return reflect(points[0], points[1]);

  return i >= n ? reflect(points[n - 1], points[n - 2]) : points[i];
}

/** A smooth curve through every point (centripetal Catmull-Rom as cubic Béziers); closed loops wrap round. */
export function catmullRom(points: readonly Pt[], closed: boolean): PathCommand[] {
  const n = points.length;
  const segments = closed ? n : n - 1;
  const out: PathCommand[] = [['M', points[0].x, points[0].y]];

  for (let i = 0; i < segments; i++) {
    const [p0, p1, p2, p3] = [-1, 0, 1, 2].map((k) => controlPoint(points, i + k, closed));

    if (dist(p1, p2) <= CR_EPS) continue;

    const [c1, c2] = controls(p0, p1, p2, p3);

    out.push(['C', c1.x, c1.y, c2.x, c2.y, p2.x, p2.y]);
  }

  return out;
}

/** A built-in shape as commands (px). Circles and ellipses start at `start` (default 12 o'clock). */
export function shapeCommands(shape: PathShape): PathCommand[] {
  const start = 'start' in shape && shape.start !== undefined ? shape.start : -90;
  const turn = 'direction' in shape && shape.direction === 'ccw' ? -360 : 360;

  if (shape.type === 'circle') return [['E', shape.cx, shape.cy, shape.r, shape.r, start, turn]];

  if (shape.type === 'ellipse') return [['E', shape.cx, shape.cy, shape.rx, shape.ry, start, turn]];

  if (shape.type === 'arc') return [['E', shape.cx, shape.cy, shape.r, shape.r, start, shape.sweep]];

  return [['W', shape.x, shape.y, shape.width, shape.amplitude, shape.wavelength, shape.phase ?? 0]];
}
