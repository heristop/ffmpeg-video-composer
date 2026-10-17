// Compile-time mattes for the shaped transitions: a shape (circle, star, heart, rounded square, or a
// glyph's counter) as a polygon around a centre, rasterised to a grey image the transition reads as an
// input. FFmpeg on device has no per-pixel shape filter (no geq), so the geometry is drawn here once.
//
// - coverage(): the shape filled at its size, anti-aliased (4×4 samples per pixel): white inside.
// - field(): per pixel, the scale the shape must grow to (about its centre) to cover that pixel, coded in
//   16 bits, 0..FIELD_LEVELS (65535) over [0, the scale that covers the whole frame]. Thresholding it at a
//   level reveals the shape at that scale, so one image and one comparison per pixel draw the shape at any
//   size (iris shapes).
//
// The shapes are star-shaped about their centre (every ray from it crosses the outline once), which is
// what makes a scale a single threshold. Pure functions of their inputs: deterministic on every platform.

import { encodePng } from '../../editor/presets/png-encode';

import type { MatteShape } from './transition-names';

export { MATTE_SHAPES, type MatteShape } from './transition-names';

export interface Point {
  x: number;
  y: number;
}

/** A closed polygon around `centre`, in pixels (y down). */
export interface Outline {
  centre: Point;
  polygon: Point[];
}

/**
 * A shaped iris's field is drawn at this fraction of the frame size: half, not the circle's quarter, since
 * straight edges and sharp points show the upscale's staircase where a round edge hides it.
 */
export const SHAPE_FIELD_DIVISOR = 2;

const STAR_POINTS = 5;
/** Inner radius of the star over its outer one: a full, friendly star rather than a spiky one. */
const STAR_INNER = 0.5;
const CIRCLE_STEPS = 96;
const HEART_STEPS = 160;
/** Corner radius of the rounded square, as a fraction of its side. */
const ROUNDED_CORNER = 0.22;
const RAYS = 2048;

function scaleTo(points: Point[], radius: number, centre: Point): Point[] {
  const reach = Math.max(...points.map((p) => Math.hypot(p.x, p.y)));

  return points.map((p) => ({ x: centre.x + (p.x / reach) * radius, y: centre.y + (p.y / reach) * radius }));
}

function circle(): Point[] {
  return Array.from({ length: CIRCLE_STEPS }, (_, i) => {
    const a = (2 * Math.PI * i) / CIRCLE_STEPS;

    return { x: Math.cos(a), y: Math.sin(a) };
  });
}

// Five points, the first straight up.
function star(): Point[] {
  return Array.from({ length: STAR_POINTS * 2 }, (_, i) => {
    const a = -Math.PI / 2 + (Math.PI * i) / STAR_POINTS;
    const r = i % 2 === 0 ? 1 : STAR_INNER;

    return { x: r * Math.cos(a), y: r * Math.sin(a) };
  });
}

// The classic parametric heart, centred on its bounding box so it opens from its middle.
function heart(): Point[] {
  const raw = Array.from({ length: HEART_STEPS }, (_, i) => {
    const t = (2 * Math.PI * i) / HEART_STEPS;

    return {
      x: 16 * Math.sin(t) ** 3,
      y: -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)),
    };
  });
  const ys = raw.map((p) => p.y);
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;

  return raw.map((p) => ({ x: p.x, y: p.y - cy }));
}

function roundedSquare(): Point[] {
  const r = ROUNDED_CORNER * 2;
  const inner = 1 - r;
  const corners = [
    [inner, inner, 0],
    [-inner, inner, 0.5],
    [-inner, -inner, 1],
    [inner, -inner, 1.5],
  ] as const;

  return corners.flatMap(([cx, cy, turn]) =>
    Array.from({ length: 9 }, (_, k) => {
      const a = Math.PI * (turn + k / 16);

      return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    })
  );
}

const SHAPES: Record<MatteShape, () => Point[]> = {
  circle,
  star,
  heart,
  'rounded-square': roundedSquare,
};

/** A named shape whose farthest point is `radius` px from `centre`. */
export function shapeOutline(shape: MatteShape, centre: Point, radius: number): Outline {
  return { centre, polygon: scaleTo(SHAPES[shape](), radius, centre) };
}

/** Distance from the centre to the outline along the ray at `angle` (the farthest crossing). */
function rayReach(outline: Outline, angle: number): number {
  const { centre, polygon } = outline;
  const [dx, dy] = [Math.cos(angle), Math.sin(angle)];
  let best = 0;

  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const [ex, ey] = [b.x - a.x, b.y - a.y];
    const det = dx * -ey - dy * -ex;

    if (Math.abs(det) < 1e-12) continue;

    const [ax, ay] = [a.x - centre.x, a.y - centre.y];
    const t = (ax * -ey - ay * -ex) / det;
    const u = (dx * ay - dy * ax) / det;

    if (t > 0 && u >= 0 && u <= 1) best = Math.max(best, t);
  }

  return best;
}

/** The outline's reach per ray, sampled on RAYS angles, read back with linear interpolation. */
export function reachTable(outline: Outline): (angle: number) => number {
  const table = Array.from({ length: RAYS }, (_, i) => rayReach(outline, (2 * Math.PI * i) / RAYS));

  return (angle) => {
    const f = ((((angle / (2 * Math.PI)) % 1) + 1) % 1) * RAYS;
    const i = Math.floor(f);
    const w = f - i;

    return table[i % RAYS] * (1 - w) + table[(i + 1) % RAYS] * w;
  };
}

/** The scale (about the centre) at which the outline reaches `point`. */
function scaleAt(reach: (angle: number) => number, centre: Point, point: Point): number {
  const r = Math.hypot(point.x - centre.x, point.y - centre.y);

  if (r === 0) return 0;

  return r / Math.max(1e-6, reach(Math.atan2(point.y - centre.y, point.x - centre.x)));
}

/** The scale at which the outline covers the whole width × height frame (its edges, sampled per pixel). */
export function coverScale(outline: Outline, width: number, height: number): number {
  const reach = reachTable(outline);
  const edge: Point[] = [];

  for (let x = 0; x <= width; x++) edge.push({ x, y: 0 }, { x, y: height });

  for (let y = 0; y <= height; y++) edge.push({ x: 0, y }, { x: width, y });

  return Math.max(...edge.map((p) => scaleAt(reach, outline.centre, p)));
}

export interface GreyImage {
  width: number;
  height: number;
  /** One byte per pixel, or two (big-endian) for a 16-bit image. */
  data: Uint8Array;
  depth?: 8 | 16;
}

/** Levels of a reveal field: 16-bit, so a level stays under a pixel even across a full-HD frame. */
export const FIELD_LEVELS = 65535;

/**
 * The reveal field over a width × height image, 16-bit: FIELD_LEVELS × (scale that covers the pixel) / `top`,
 * clamped. `top` defaults to the scale covering the whole image, so the top level is the last pixel to show.
 * (8 bits would give a level several pixels wide on a large frame: a staircase along straight edges.)
 */
export function revealField(outline: Outline, width: number, height: number, top?: number): GreyImage {
  const reach = reachTable(outline);
  const max = top ?? coverScale(outline, width, height);
  const data = new Uint8Array(width * height * 2);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = scaleAt(reach, outline.centre, { x: x + 0.5, y: y + 0.5 });
      const level = Math.min(FIELD_LEVELS, Math.round((FIELD_LEVELS * s) / max));
      const at = 2 * (y * width + x);
      data[at] = level >> 8;
      data[at + 1] = level & 0xff;
    }
  }

  return { width, height, data, depth: 16 };
}

/** The level of a 16-bit field at pixel index `i`. */
export function fieldLevel(image: GreyImage, i: number): number {
  return (image.data[2 * i] << 8) | image.data[2 * i + 1];
}

const SAMPLES = 4;

interface Crossing {
  x: number;
  /** +1 for an edge going down the screen (y increasing), −1 going up. */
  sign: number;
}

// Where the polygons' edges cross the sub-row y. A sample at x is inside when the signs of the crossings to
// its right sum to non-zero (the non-zero winding rule of a ray cast to the right).
function crossings(polygons: Point[][], y: number): Crossing[] {
  const found: Crossing[] = [];

  for (const polygon of polygons) {
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      const down = a.y <= y && b.y > y;

      if (down || (a.y > y && b.y <= y)) {
        found.push({ x: a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y), sign: down ? 1 : -1 });
      }
    }
  }

  return found.sort((p, q) => p.x - q.x);
}

// Adds, per pixel of the row, the samples of sub-row y inside the polygons: the crossings sorted once, then
// each span between two crossings filled when its winding is non-zero. Samples sit at (j + 0.5) / SAMPLES.
function addSubRow(hits: Uint8Array, polygons: Point[][], y: number, width: number): void {
  const row = crossings(polygons, y);
  const last = width * SAMPLES;
  let winding = row.reduce((sum, c) => sum + c.sign, 0);

  for (let k = 0; k < row.length; k++) {
    winding -= row[k].sign;

    if (winding === 0) continue;

    const from = Math.max(0, Math.ceil(row[k].x * SAMPLES - 0.5));
    const to = Math.min(last, k + 1 < row.length ? Math.ceil(row[k + 1].x * SAMPLES - 0.5) : last);

    for (let j = from; j < to; j++) hits[Math.floor(j / SAMPLES)]++;
  }
}

/**
 * The polygons filled (non-zero winding) white on black over width × height, anti-aliased (4×4 samples per
 * pixel). A scanline per sub-row: about height × 4 × edges crossings plus one pass over the samples, instead of
 * every edge for every sample.
 */
export function coverage(polygons: Point[][], width: number, height: number): GreyImage {
  const data = new Uint8Array(width * height);
  const ys = polygons.flat().map((p) => p.y);
  const hits = new Uint8Array(width);

  for (let y = Math.max(0, Math.floor(Math.min(...ys))); y < Math.min(height, Math.ceil(Math.max(...ys)) + 1); y++) {
    hits.fill(0);

    for (let sy = 0; sy < SAMPLES; sy++) addSubRow(hits, polygons, y + (sy + 0.5) / SAMPLES, width);

    for (let x = 0; x < width; x++) data[y * width + x] = Math.round((255 * hits[x]) / (SAMPLES * SAMPLES));
  }

  return { width, height, data };
}

export function greyPng(image: GreyImage): Uint8Array {
  return encodePng({
    width: image.width,
    height: image.height,
    channels: 1,
    data: image.data,
    depth: image.depth ?? 8,
  });
}

/** Signed area (y down: positive = clockwise on screen). */
export function signedArea(polygon: Point[]): number {
  let sum = 0;

  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    sum += a.x * b.y - b.x * a.y;
  }

  return sum / 2;
}

export function centroid(polygon: Point[]): Point {
  const area = signedArea(polygon);
  let [cx, cy] = [0, 0];

  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const cross = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }

  return { x: cx / (6 * area), y: cy / (6 * area) };
}
