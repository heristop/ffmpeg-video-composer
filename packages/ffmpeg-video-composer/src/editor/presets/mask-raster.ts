// Shape masks drawn at compile time, like the path graphic's traces (path-raster.ts): plain typed-array maths
// and the stored-deflate PNG encoder, so a `mask:` URL produces the same bytes on Node, Expo/Hermes and
// browser/WASM. The image is GREYSCALE, 255 inside and 0 outside: every subpath is closed and filled by the
// non-zero rule on 4 sub-rows per pixel with exact horizontal coverage, then a feathered mask is softened by
// three box passes each way (close to a gaussian whose 10-90 % ramp is `feather` px).
//
// A `mask:` URL can be authored by an untrusted agent, so everything is bounded BEFORE it is spent: the URL is
// matched by a strict grammar (integer sizes, a plain decimal feather, a length-capped path of known tokens),
// the flattened point count is estimated from the control polygon, the fill's work (edge heights in sub-rows)
// is summed before any crossing is stored, and the pixel count caps the feather's cost. Every limit is written
// `!(value <= MAX)` so a NaN fails closed.

import { fnv1a32 } from '@/core/determinism/hash';
import { MAX_MASK_FEATHER } from '../../schemas/mask.schemas';
import { encodePng, type PngImage } from './png-encode';
import type { Pt } from './path-geometry';
import { decodeCommands, encodeCommands } from './path-svg';
import {
  featherRadius,
  flattenWithin,
  MAX_ENCODED_PATH,
  MAX_MASK_POINTS,
  MAX_MASK_PIXELS,
  MAX_MASK_SIDE,
  pointBudget,
} from './mask-shape';

export interface MaskImageSpec {
  w: number;
  h: number;
  /** Soft edge width in px (0: a crisp, anti-aliased edge). */
  feather: number;
  /** The shape's commands relative to the image, encoded (path-svg.ts encodeCommands). */
  path: string;
}

export interface Edge {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  dir: number;
}

/** Most sub-row crossings one fill may store (about 9 bytes each, so 36 MB). */
export const MAX_FILL_WORK = 4_000_000;

const SCHEME = 'mask:';
const SUB = 4;
const BOX_PASSES = 3;
const NUMBER = String.raw`-?(?:\d+(?:\.\d+)?|\.\d+)`;
const COMMAND = String.raw`[MLCQEWZ](?:${NUMBER}(?:_${NUMBER})*)?`;
const URL_FORM = new RegExp(
  String.raw`^mask:w=([1-9]\d{0,3}),h=([1-9]\d{0,3}),f=((?:0|[1-9]\d{0,2})(?:\.\d{1,3})?),d=((?:${COMMAND})+)$`
);

function sizeOk(spec: MaskImageSpec): boolean {
  const { w, h } = spec;
  const sides = Number.isInteger(w) && Number.isInteger(h) && w >= 1 && h >= 1;

  return sides && w <= MAX_MASK_SIDE && h <= MAX_MASK_SIDE && w * h <= MAX_MASK_PIXELS;
}

// Every edge of every subpath, closed, oriented top to bottom with its winding direction; flat edges dropped.
function edgesOf(subpaths: Pt[][]): Edge[] {
  return subpaths.flatMap((points) =>
    points
      .map((a, i): Edge => {
        const b = points[(i + 1) % points.length];

        return a.y <= b.y
          ? { x0: a.x, y0: a.y, x1: b.x, y1: b.y, dir: 1 }
          : { x0: b.x, y0: b.y, x1: a.x, y1: a.y, dir: -1 };
      })
      .filter((edge) => edge.y1 > edge.y0)
  );
}

// The first and last sub-row (sampled at its centre) an edge crosses, clipped to the raster.
function rowRange(edge: Edge, rows: number): [number, number] {
  return [Math.max(0, Math.ceil(edge.y0 * SUB - 0.5)), Math.min(rows - 1, Math.ceil(edge.y1 * SUB - 0.5) - 1)];
}

/** Sub-rows the edges cross inside a raster of `rows` sub-rows: the crossings a fill would store (NaN stays NaN). */
export function fillWork(edges: readonly Edge[], rows: number): number {
  let work = 0;

  for (const edge of edges) {
    const [first, last] = rowRange(edge, rows);

    work += Math.max(0, last - first + 1);
  }

  return work;
}

interface Crossings {
  /** The crossings of sub-row k are [start[k], start[k + 1]). */
  start: Uint32Array;
  xs: Float64Array;
  dirs: Int8Array;
}

// For every sub-row, where each edge crosses it and the edge's direction (two passes: count, then place).
function crossings(edges: readonly Edge[], rows: number): Crossings {
  const start = new Uint32Array(rows + 1);

  for (const edge of edges) {
    const [first, last] = rowRange(edge, rows);

    for (let k = first; k <= last; k++) start[k + 1]++;
  }

  for (let k = 0; k < rows; k++) start[k + 1] += start[k];

  const out: Crossings = { start, xs: new Float64Array(start[rows]), dirs: new Int8Array(start[rows]) };
  const next = start.slice(0, rows);

  for (const edge of edges) {
    const [first, last] = rowRange(edge, rows);
    const slope = (edge.x1 - edge.x0) / (edge.y1 - edge.y0);

    for (let k = first; k <= last; k++) {
      out.xs[next[k]] = edge.x0 + ((k + 0.5) / SUB - edge.y0) * slope;
      out.dirs[next[k]++] = edge.dir;
    }
  }

  return out;
}

// Adds `weight` x the covered length of [from, to) to each pixel of a row.
function addSpan(row: Float32Array, from: number, to: number, weight: number): void {
  const [a, b] = [Math.max(0, from), Math.min(row.length, to)];

  if (b <= a) return;

  const [i, j] = [Math.floor(a), Math.floor(b)];

  if (i === j) {
    row[i] += (b - a) * weight;

    return;
  }

  row[i] += (i + 1 - a) * weight;

  for (let k = i + 1; k < j; k++) row[k] += weight;

  if (j < row.length) row[j] += (b - j) * weight;
}

// One sub-row: walk the crossings left to right, filling wherever the winding number is not zero.
function fillSubRow(row: Float32Array, c: Crossings, sub: number): void {
  const [from, to] = [c.start[sub], c.start[sub + 1]];
  const order = Array.from({ length: to - from }, (_, i) => from + i).sort((p, q) => c.xs[p] - c.xs[q]);
  let winding = 0;

  for (let i = 0; i < order.length - 1; i++) {
    winding += c.dirs[order[i]];

    if (winding !== 0) addSpan(row, c.xs[order[i]], c.xs[order[i + 1]], 1 / SUB);
  }
}

// The outline of the last few specs checked, by canonical URL: parsing a URL and drawing it flatten it once.
const OUTLINES = new Map<string, Pt[][]>();
const OUTLINE_SLOTS = 8;

// The flattened subpaths when the spec can be filled within every bound, else why not.
function outlineOf(spec: MaskImageSpec): Pt[][] | string {
  const key = maskUrl(spec);
  const known = OUTLINES.get(key);

  if (known) return known;

  const commands = sizeOk(spec) ? decodeCommands(spec.path) : null;

  if (!commands) return 'the size or the path is not valid';

  if (!(pointBudget(commands) <= MAX_MASK_POINTS)) {
    return `the path is too detailed to fill (over ${MAX_MASK_POINTS} points once flattened), or has a non-positive radius, width or wavelength`;
  }

  const subpaths = flattenWithin(commands, MAX_MASK_POINTS);

  if (!subpaths || !subpaths.every((points) => points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)))) {
    return 'the path has a non-finite point or is too detailed to fill';
  }

  if (!(fillWork(edgesOf(subpaths), spec.h * SUB) <= MAX_FILL_WORK)) return 'the path is too costly to fill';

  if (OUTLINES.size >= OUTLINE_SLOTS) OUTLINES.delete(OUTLINES.keys().next().value as string);

  OUTLINES.set(key, subpaths);

  return subpaths;
}

/** Per-pixel coverage 0..1 of the spec's shape before any feather; null when it does not decode or is too costly. */
export function maskCoverage(spec: MaskImageSpec): Float32Array | null {
  const subpaths = outlineOf(spec);

  if (typeof subpaths === 'string') return null;

  const cross = crossings(edgesOf(subpaths), spec.h * SUB);
  const out = new Float32Array(spec.w * spec.h);

  for (let y = 0; y < spec.h; y++) {
    const row = out.subarray(y * spec.w, (y + 1) * spec.w);

    for (let s = 0; s < SUB; s++) fillSubRow(row, cross, y * SUB + s);
  }

  return out;
}

type MaskSize = Pick<MaskImageSpec, 'w' | 'h'>;

// One box pass of radius r along the rows (horizontal) or the columns, zero outside the image.
function boxPass(src: Float32Array, out: Float32Array, size: MaskSize, r: number, horizontal: boolean): void {
  const [lines, length] = horizontal ? [size.h, size.w] : [size.w, size.h];
  const [step, stride] = horizontal ? [1, size.w] : [size.w, 1];

  for (let line = 0; line < lines; line++) {
    const base = line * stride;
    let sum = 0;

    for (let i = 0; i <= Math.min(r, length - 1); i++) sum += src[base + i * step];

    for (let i = 0; i < length; i++) {
      out[base + i * step] = sum / (2 * r + 1);

      if (i + r + 1 < length) sum += src[base + (i + r + 1) * step];

      if (i - r >= 0) sum -= src[base + (i - r) * step];
    }
  }
}

// Softens the coverage in place: the passes alternate between it and one spare buffer, and an even number of
// passes ends back in the coverage.
function feathered(coverage: Float32Array, spec: MaskImageSpec): Float32Array {
  const r = featherRadius(spec.feather);

  if (r === 0) return coverage;

  const spare = new Float32Array(coverage.length);

  for (let pass = 0; pass < BOX_PASSES; pass++) {
    boxPass(coverage, spare, spec, r, true);
    boxPass(spare, coverage, spec, r, false);
  }

  return coverage;
}

/** The grey image a spec describes (all black when its path does not decode or is too costly to fill). */
export function maskImage(spec: MaskImageSpec): PngImage {
  if (!sizeOk(spec)) throw new RangeError(`mask size ${spec.w}x${spec.h} is out of bounds`);

  const coverage = maskCoverage(spec);
  const data = new Uint8Array(spec.w * spec.h);
  const image: PngImage = { width: spec.w, height: spec.h, channels: 1, data };

  if (!coverage) return image;

  const soft = feathered(coverage, spec);

  for (let k = 0; k < data.length; k++) data[k] = Math.round(255 * Math.min(1, Math.max(0, soft[k])));

  return image;
}

export function maskPng(spec: MaskImageSpec): Uint8Array {
  return encodePng(maskImage(spec));
}

function num(value: number): string {
  return String(Number(value.toFixed(3)));
}

/** The canonical `mask:` URL of a spec (fixed key order, the path last). */
export function maskUrl(spec: MaskImageSpec): string {
  return `${SCHEME}w=${spec.w},h=${spec.h},f=${num(spec.feather)},d=${spec.path}`;
}

/** A `mask:` URL's spec, or why it is refused. The path is re-encoded, so equal shapes share one canonical URL. */
function inspectMaskUrl(url: string): MaskImageSpec | string {
  if (url.length > MAX_ENCODED_PATH + 64) return 'the URL is too long';

  const match = URL_FORM.exec(url);

  if (!match) return 'expected mask:w=<1-4096>,h=<1-4096>,f=<0-200>,d=<path of M L C Q E W Z>';

  const commands = match[4].length <= MAX_ENCODED_PATH ? decodeCommands(match[4]) : null;

  if (!commands) return 'the path is too long or malformed';

  const spec = { w: Number(match[1]), h: Number(match[2]), feather: Number(match[3]), path: encodeCommands(commands) };

  if (spec.feather > MAX_MASK_FEATHER) return `the feather is over ${MAX_MASK_FEATHER} px`;

  if (spec.w * spec.h > MAX_MASK_PIXELS) return `the image is over ${MAX_MASK_PIXELS} px in all`;

  const outline = outlineOf(spec);

  return typeof outline === 'string' ? outline : spec;
}

/** Parses a `mask:` URL back to its spec; null for any other string or an invalid, oversized or too costly one. */
export function parseMaskUrl(url: string): MaskImageSpec | null {
  const spec = url.startsWith(SCHEME) ? inspectMaskUrl(url) : null;

  return typeof spec === 'string' ? null : spec;
}

/** Why a `mask:` URL is refused; null for a valid one and for any other string. */
export function maskUrlProblem(url: string): string | null {
  const spec = url.startsWith(SCHEME) ? inspectMaskUrl(url) : null;

  return typeof spec === 'string' ? spec : null;
}

/** A deterministic file name for a spec, e.g. `mask-1a2b3c4d.png`. */
export function maskFileName(spec: MaskImageSpec): string {
  return `mask-${fnv1a32(maskUrl(spec)).toString(16).padStart(8, '0')}.png`;
}
