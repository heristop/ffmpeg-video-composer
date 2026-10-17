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
import { flatten } from './path-geometry';
import { traceImage, urlPairs } from './path-raster';
import { decodeCommands } from './path-svg';
import { fillCoverage, type FillRule } from './shape-fill';

export const MAX_SHAPE_SIDE = 4096;
/** 4 MP: a 16 MB RGBA buffer at most, on the memory-constrained WASM and Hermes targets too. */
export const MAX_SHAPE_PIXELS = 4_194_304;
const MAX_STROKE = 640;
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

function paintAt(spec: ShapeSpec, x: number, y: number, c1: Rgba, c2: Rgba): Rgba {
  if (spec.fill !== 'linear' && spec.fill !== 'radial') return c1;

  const t = gradientAt(spec, x, y);

  return c1.map((value, i) => value + (c2[i] - value) * t) as Rgba;
}

// The outline over the fill ("over", straight alpha); a transparent pixel keeps the fill's RGB.
function blend(fill: Rgba, stroke: Rgba, fa: number, sa: number): number[] {
  const alpha = sa + fa * (1 - sa);

  if (alpha <= 0) return [Math.round(fill[0]), Math.round(fill[1]), Math.round(fill[2]), 0];

  const rgb = [0, 1, 2].map((i) => Math.round((stroke[i] * sa + fill[i] * fa * (1 - sa)) / alpha));

  return [...rgb, Math.round(255 * alpha)];
}

function strokeCover(spec: ShapeSpec): Uint8Array | null {
  if (spec.sw <= 0) return null;

  const cover = traceImage({
    mode: 'cover',
    x: 0,
    y: 0,
    w: spec.w,
    h: spec.h,
    thickness: spec.sw,
    caps: 'round',
    path: spec.path,
  });

  return cover.data;
}

/** Integer sides of 1..MAX_SHAPE_SIDE within MAX_SHAPE_PIXELS in all. */
function validSize(w: number, h: number): boolean {
  const inRange = [w, h].every((v) => Number.isInteger(v) && v >= 1 && v <= MAX_SHAPE_SIDE);

  return inRange && w * h <= MAX_SHAPE_PIXELS;
}

/** The RGBA image a spec describes; throws on a raster size outside the limits, before allocating. */
export function shapeImage(spec: ShapeSpec): PngImage {
  const { w, h } = spec;

  if (!validSize(w, h)) throw new Error(`Invalid shape size ${w}x${h}`);

  const data = new Uint8Array(w * h * 4);
  const commands = decodeCommands(spec.path);
  const cover = commands && spec.fill !== 'none' ? fillCoverage(flatten(commands), w, h, spec.rule) : null;
  const stroke = commands ? strokeCover(spec) : null;
  const [c1, c2, sc] = [rgbaOf(spec.c1 ?? spec.sc), rgbaOf(spec.c2), rgbaOf(spec.sc)];

  for (let k = 0; k < w * h; k++) {
    const fill = paintAt(spec, k % w, Math.floor(k / w), c1, c2);
    const fa = cover ? cover[k] * fill[3] : 0;
    const sa = stroke ? (stroke[k * 4 + 3] / 255) * sc[3] : 0;

    data.set(blend(fill, sc, fa, sa), k * 4);
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

function sizeOf(pairs: Map<string, string>): [number, number] | null {
  const [w, h] = ['w', 'h'].map((key) => Number(pairs.get(key)));

  return validSize(w, h) ? [w, h] : null;
}

// A colour field: absent, a valid rrggbbaa, or null when present but malformed.
function colour(pairs: Map<string, string>, key: string): string | undefined | null {
  const value = pairs.get(key);

  if (value === undefined) return undefined;

  return HEX8.test(value) ? value : null;
}

function paintOf(pairs: Map<string, string>): Pick<ShapeSpec, 'fill' | 'c1' | 'c2' | 'angle' | 'sc'> | null {
  const fill = pairs.get('fill') as ShapeFill;
  const [c1, c2, sc] = ['c1', 'c2', 'sc'].map((key) => colour(pairs, key));
  const angle = pairs.has('a') ? Number(pairs.get('a')) : undefined;

  if (!FILLS.includes(fill) || [c1, c2, sc].includes(null)) return null;

  if (angle !== undefined && !Number.isFinite(angle)) return null;

  return {
    fill,
    ...(c1 ? { c1 } : {}),
    ...(c2 ? { c2 } : {}),
    ...(angle === undefined ? {} : { angle }),
    ...(sc ? { sc } : {}),
  };
}

/** Parses a `shape:` URL back to its spec; null for any other string or an invalid or oversized spec. */
export function parseShapeUrl(url: string): ShapeSpec | null {
  if (!url.startsWith(SCHEME)) return null;

  if (url.length > MAX_ENCODED_PATH + 512) return null;

  const pairs = urlPairs(url, SCHEME);
  const size = sizeOf(pairs);
  const paint = paintOf(pairs);
  const rule = pairs.get('rule');
  const sw = Number(pairs.get('sw'));
  const path = pairs.get('d') ?? '';

  if (!size || !paint || (rule !== 'nonzero' && rule !== 'evenodd')) return null;

  if (!(sw >= 0 && sw <= MAX_STROKE)) return null;

  if (path.length > MAX_ENCODED_PATH || decodeCommands(path) === null) return null;

  return { w: size[0], h: size[1], rule, ...paint, sw, path };
}

/** A deterministic file name for a spec, e.g. `shape-1a2b3c4d.png`. */
export function shapeFileName(spec: ShapeSpec): string {
  return `shape-${fnv1a32(shapeUrl(spec)).toString(16).padStart(8, '0')}.png`;
}
