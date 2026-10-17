// packages/ffmpeg-video-composer/src/editor/presets/shape-raster.ts
// The compile-time image of the shape graphic (graphics[].type "shape"): the outline filled (a colour, or a
// linear / radial gradient across the box; nonzero or evenodd) and optionally stroked, anti-aliased, as one
// RGBA PNG at the raster size the lowering picked (shape-plan.ts). Plain Uint8Array maths and the
// stored-deflate encoder, so a `shape:` URL produces the same bytes on Node, Expo/Hermes and browser/WASM
// (generated-images.ts). The outline is the path graphic's cover (path-raster.ts). Transparent pixels keep
// the paint's RGB, so the overlay leg's scale never pulls a dark fringe into the edge. A URL is refused
// before any allocation when it is larger than MAX_SHAPE_SIDE per side or MAX_SHAPE_PIXELS in all.

import { fnv1a32 } from '@/core/determinism/hash';
import { encodePng, type PngImage } from './png-encode';
import { flattenWithin, type Pt } from './path-geometry';
import { urlPairs } from './path-raster';
import { decodeCommands } from './path-svg';
import { fillCoverage, type FillRule } from './shape-fill';

export const MAX_SHAPE_SIDE = 4096;
/** 4 MP: a 16 MB RGBA buffer at most, on the memory-constrained WASM and Hermes targets too. */
export const MAX_SHAPE_PIXELS = 4_194_304;
const MAX_STROKE = 640;
/** Flattened points a spec may hold (a bundled preset or svg outline stays far below it). */
export const MAX_SHAPE_POINTS = 20_000;
/** Pixel visits the outline's stroke may cost (the sum over its segments of the band each paints). */
const MAX_STROKE_WORK = 50_000_000;
/** Characters of the encoded outline a spec may carry (refused before decoding, so a hostile URL costs nothing). */
export const MAX_ENCODED_PATH = 65_536;
const SCHEME = 'shape:';
const FILLS = ['none', 'solid', 'linear', 'radial'] as const;
const HEX8 = /^[0-9a-f]{8}$/;

export type ShapeFill = (typeof FILLS)[number];

export interface ShapeSpec {
  /** Raster size in px. */
  w: number;
  h: number;
  rule: FillRule;
  fill: ShapeFill;
  /** rrggbbaa: the solid colour, or the gradient's start. */
  c1?: string;
  /** rrggbbaa: the gradient's end. */
  c2?: string;
  /** Linear gradient angle, CSS degrees. */
  angle?: number;
  /** Outline width in raster px (0: none). */
  sw: number;
  /** rrggbbaa: the outline colour. */
  sc?: string;
  /** The outline's commands in raster px, encoded (path-svg.ts encodeCommands). */
  path: string;
}

/** RGB 0..255 and alpha 0..1. */
type Rgba = [number, number, number, number];

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function rgbaOf(hex: string | undefined): Rgba {
  const text = hex !== undefined && HEX8.test(hex) ? hex : 'ffffffff';
  const [r, g, b, a] = [0, 2, 4, 6].map((at) => parseInt(text.slice(at, at + 2), 16));

  return [r, g, b, a / 255];
}

/** Where pixel (x, y) sits along the gradient: 0 (c1) … 1 (c2). */
function gradientAt(spec: ShapeSpec, x: number, y: number): number {
  const [dx, dy] = [x + 0.5 - spec.w / 2, y + 0.5 - spec.h / 2];

  if (spec.fill === 'radial') return clamp01(Math.hypot(dx / (spec.w / 2), dy / (spec.h / 2)));

  const rad = ((spec.angle ?? 180) * Math.PI) / 180;
  const [ux, uy] = [Math.sin(rad), -Math.cos(rad)];
  const span = Math.abs(spec.w * ux) + Math.abs(spec.h * uy);

  return clamp01((dx * ux + dy * uy) / span + 0.5);
}

// The fill paint of pixel (x, y) into `out` (reused across pixels: no per-pixel allocation).
function paintAt(spec: ShapeSpec, x: number, y: number, [c1, c2]: [Rgba, Rgba], out: Rgba): void {
  const t = spec.fill === 'linear' || spec.fill === 'radial' ? gradientAt(spec, x, y) : 0;

  for (let i = 0; i < 4; i++) out[i] = c1[i] + (c2[i] - c1[i]) * t;
}

// The outline over the fill ("over", straight alpha) written at data[at]; a transparent pixel keeps the fill's RGB.
function blendInto(data: Uint8Array, at: number, fill: Rgba, stroke: Rgba, [fa, sa]: [number, number]): void {
  const alpha = sa + fa * (1 - sa);

  for (let i = 0; i < 3; i++) {
    data[at + i] = Math.round(alpha <= 0 ? fill[i] : (stroke[i] * sa + fill[i] * fa * (1 - sa)) / alpha);
  }

  data[at + 3] = alpha <= 0 ? 0 : Math.round(255 * alpha);
}

// Pixels a segment's capsule touches, upper bound (used to refuse a stroke before painting it).
function segmentWork(a: Pt, b: Pt, reach: number, spec: ShapeSpec): number {
  const area = (Math.hypot(b.x - a.x, b.y - a.y) + 2 * reach + 2) * (2 * reach + 2);

  return Math.min(area, spec.w * spec.h);
}

function strokeWork(lines: Pt[][], spec: ShapeSpec): number {
  const reach = spec.sw / 2 + 1;

  return lines.reduce(
    (sum, points) => points.slice(1).reduce((n, b, j) => n + segmentWork(points[j], b, reach, spec), sum),
    0
  );
}

// One segment's capsule over the cover: only the band of each row near the segment is visited, so the cost
// follows its length times the stroke width, not its bounding box.
function paintStroke(cover: Float32Array, a: Pt, b: Pt, spec: ShapeSpec): void {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const len = Math.hypot(dx, dy);
  const [half, reach] = [spec.sw / 2, spec.sw / 2 + 1];

  if (len < 1e-12) return;

  const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - reach));
  const y1 = Math.min(spec.h - 1, Math.ceil(Math.max(a.y, b.y) + reach));
  const [bx0, bx1] = [Math.min(a.x, b.x) - reach, Math.max(a.x, b.x) + reach];

  for (let py = y0; py <= y1; py++) {
    const cy = py + 0.5 - a.y;
    // x where the pixel centre lies within `reach` of the infinite line (the whole bbox row when horizontal).
    const [lo, hi] =
      Math.abs(dy) < 1e-9
        ? [bx0, bx1]
        : [(cy * dx - reach * len) / dy + a.x, (cy * dx + reach * len) / dy + a.x].sort((m, n) => m - n);
    const x0 = Math.max(0, Math.floor(Math.max(bx0, lo)));
    const x1 = Math.min(spec.w - 1, Math.ceil(Math.min(bx1, hi)));

    for (let px = x0; px <= x1; px++) {
      const cx = px + 0.5 - a.x;
      const u = Math.min(len, Math.max(0, (cx * dx + cy * dy) / len));
      const [ex, ey] = [cx - (dx * u) / len, cy - (dy * u) / len];
      const d = Math.sqrt(ex * ex + ey * ey);
      const k = py * spec.w + px;

      cover[k] = Math.max(cover[k], clamp01(half - d + 0.5));
    }
  }
}

function strokeCover(lines: Pt[][], spec: ShapeSpec): Float32Array | null {
  if (spec.sw <= 0) return null;

  const cover = new Float32Array(spec.w * spec.h);

  for (const points of lines) {
    for (let j = 1; j < points.length; j++) paintStroke(cover, points[j - 1], points[j], spec);
  }

  return cover;
}

/** Integer sides of 1..MAX_SHAPE_SIDE within MAX_SHAPE_PIXELS in all. */
function validSize(w: number, h: number): boolean {
  const inRange = [w, h].every((v) => Number.isInteger(v) && v >= 1 && v <= MAX_SHAPE_SIDE);

  return inRange && w * h <= MAX_SHAPE_PIXELS;
}

/** The spec's flattened outline, or why it is refused (too many points, or a stroke too costly to paint). */
function outlineOf(spec: ShapeSpec): { lines: Pt[][] } | { error: string } {
  const commands = decodeCommands(spec.path);
  const lines = commands && flattenWithin(commands, MAX_SHAPE_POINTS);

  if (!lines) return { error: `Shape outline exceeds ${MAX_SHAPE_POINTS} points` };

  if (spec.sw > 0 && strokeWork(lines, spec) > MAX_STROKE_WORK) return { error: 'Shape stroke is too costly to paint' };

  return { lines };
}

/** The RGBA image a spec describes; throws on a raster size outside the limits, before allocating. */
export function shapeImage(spec: ShapeSpec): PngImage {
  const { w, h } = spec;

  if (!validSize(w, h)) throw new Error(`Invalid shape size ${w}x${h}`);

  const outline = outlineOf(spec);

  if ('error' in outline) throw new Error(outline.error);

  const data = new Uint8Array(w * h * 4);
  const cover = spec.fill === 'none' ? null : fillCoverage(outline.lines, w, h, spec.rule);
  const stroke = strokeCover(outline.lines, spec);
  const [c1, c2, sc] = [rgbaOf(spec.c1 ?? spec.sc), rgbaOf(spec.c2), rgbaOf(spec.sc)];

  const fill: Rgba = [0, 0, 0, 0];

  for (let k = 0; k < w * h; k++) {
    paintAt(spec, k % w, Math.floor(k / w), [c1, c2], fill);
    blendInto(data, k * 4, fill, sc, [cover ? cover[k] * fill[3] : 0, stroke ? stroke[k] * sc[3] : 0]);
  }

  return { width: w, height: h, channels: 4, data };
}

export function shapePng(spec: ShapeSpec): Uint8Array {
  return encodePng(shapeImage(spec));
}

function num(value: number): string {
  return String(Number(value.toFixed(3)));
}

/** The canonical `shape:` URL of a spec (fixed key order, the path last). */
export function shapeUrl(spec: ShapeSpec): string {
  const parts = [
    `w=${spec.w}`,
    `h=${spec.h}`,
    `rule=${spec.rule}`,
    `fill=${spec.fill}`,
    ...(spec.c1 ? [`c1=${spec.c1}`] : []),
    ...(spec.c2 ? [`c2=${spec.c2}`] : []),
    ...(spec.angle === undefined ? [] : [`a=${num(spec.angle)}`]),
    `sw=${num(spec.sw)}`,
    ...(spec.sc ? [`sc=${spec.sc}`] : []),
    `d=${spec.path}`,
  ];

  return `${SCHEME}${parts.join(',')}`;
}

const DIGITS = /^\d{1,5}$/;
const DECIMAL = /^-?\d{1,6}(\.\d{1,9})?$/;

/** A decimal field rounded to the 3 places the URL prints, so the hashed URL and the painted spec agree. */
function decimal(pairs: Map<string, string>, key: string): number | undefined | null {
  const value = pairs.get(key);

  if (value === undefined) return undefined;

  return DECIMAL.test(value) ? Math.round(Number(value) * 1000) / 1000 : null;
}

function sizeOf(pairs: Map<string, string>): [number, number] | null {
  const [wText, hText] = [pairs.get('w') ?? '', pairs.get('h') ?? ''];
  const [w, h] = [Number(wText), Number(hText)];

  return DIGITS.test(wText) && DIGITS.test(hText) && validSize(w, h) ? [w, h] : null;
}

// A colour field: absent, a valid rrggbbaa, or null when present but malformed.
function colour(pairs: Map<string, string>, key: string): string | undefined | null {
  const value = pairs.get(key);

  if (value === undefined) return undefined;

  return HEX8.test(value) ? value : null;
}

// The colours a fill needs: solid its c1, a gradient c1 and c2.
function hasColours(fill: ShapeFill, c1: string | undefined, c2: string | undefined): boolean {
  if (fill === 'solid') return c1 !== undefined;

  return fill === 'none' || (c1 !== undefined && c2 !== undefined);
}

function paintOf(pairs: Map<string, string>): Pick<ShapeSpec, 'fill' | 'c1' | 'c2' | 'angle' | 'sc'> | null {
  const fill = pairs.get('fill') as ShapeFill;
  const [c1, c2, sc] = ['c1', 'c2', 'sc'].map((key) => colour(pairs, key));
  const angle = decimal(pairs, 'a');

  if (!FILLS.includes(fill) || [c1, c2, sc, angle].includes(null)) return null;

  if (angle !== undefined && Math.abs(angle as number) > 360) return null;

  if (!hasColours(fill, c1 as string | undefined, c2 as string | undefined)) return null;

  return {
    fill,
    ...(c1 ? { c1 } : {}),
    ...(c2 ? { c2 } : {}),
    ...(angle === undefined ? {} : { angle: angle as number }),
    ...(sc ? { sc } : {}),
  };
}

function strokeWidthOk(sw: number | null | undefined): boolean {
  return sw !== undefined && sw !== null && sw >= 0 && sw <= MAX_STROKE;
}

/** Parses a `shape:` URL back to its spec; null for any other string or an invalid, oversized or too costly spec. */
export function parseShapeUrl(url: string): ShapeSpec | null {
  if (!url.startsWith(SCHEME) || url.length > MAX_ENCODED_PATH + 512) return null;

  const pairs = urlPairs(url, SCHEME);
  const size = sizeOf(pairs);
  const paint = paintOf(pairs);
  const rule = pairs.get('rule');
  const sw = decimal(pairs, 'sw');
  const path = pairs.get('d') ?? '';

  if (!size || !paint || (rule !== 'nonzero' && rule !== 'evenodd')) return null;

  if (!strokeWidthOk(sw) || path.length > MAX_ENCODED_PATH || decodeCommands(path) === null) return null;

  const spec: ShapeSpec = { w: size[0], h: size[1], rule, ...paint, sw: sw as number, path };

  return 'error' in outlineOf(spec) ? null : spec;
}

/** A deterministic file name for a spec, e.g. `shape-1a2b3c4d.png`. */
export function shapeFileName(spec: ShapeSpec): string {
  return `shape-${fnv1a32(shapeUrl(spec)).toString(16).padStart(8, '0')}.png`;
}
