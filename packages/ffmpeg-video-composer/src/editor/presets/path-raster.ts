// Compile-time images of the path graphic, rendered at their exact on-screen size like the fx sprites
// (fx-sprites.ts): plain Uint8Array maths and the stored-deflate PNG encoder, so a `trace:` URL produces the
// same bytes on Node, Expo/Hermes and browser/WASM. Two images per path, over the same box:
//
// - cover: the whole stroke, RGB = its colour on every pixel and alpha = anti-aliased coverage (round or
//   butt caps, round joins, optional dashes). `lo`/`hi` bake a trim window into it: the held state of a
//   partial draw (a ring at 75%).
// - code: GRAYSCALE, each stroke pixel's position along the path, 1 (start) … 255 (end), 0 off the stroke.
//   The lowering (path-draw.ts) thresholds it with `lutyuv` per output frame to reveal the drawn part.
//
// Each pixel takes the arc length of the nearest piece of the path, so a self-crossing path reveals the
// crossing with whichever pass runs closest to it.

import { fnv1a32 } from '@/core/determinism/hash';
import { encodePng, type PngImage } from './png-encode';
import { flatten, flattenWithin, traceOf, type Pt } from './path-geometry';
import { decodeCommands } from './path-svg';

export interface TraceSpec {
  mode: 'cover' | 'code';
  /** Top-left of the image in frame px (the path's commands are in frame px). */
  x: number;
  y: number;
  w: number;
  h: number;
  thickness: number;
  caps: 'round' | 'butt';
  /** [on, off] px along the path. */
  dash?: [number, number];
  /** 6-hex RGB without `#` (cover only; default ffffff). */
  color?: string;
  /** Trim window baked into a cover, as fractions of the length (default 0 and 1). */
  lo?: number;
  hi?: number;
  /** The path's commands, encoded (path-geometry.ts encodeCommands). */
  path: string;
}

const SCHEME = 'trace:';
const MAX_DIMENSION = 4096;
/** The thickest line the path graphic's schema allows (px). */
const MAX_THICKNESS = 80;
/** Flattened points a `trace:` path may hold. */
const MAX_TRACE_POINTS = 20_000;
/** Pixel visits the painting of a spec may cost (the sum over its segments of the band each paints). */
const MAX_TRACE_WORK = 20_000_000;

/** The code a position along the path (fraction 0..1) is stored as. */
export function codeOf(fraction: number): number {
  return Math.min(255, Math.max(1, Math.round(0.5 + fraction * 255)));
}

/** The code-space edge of a drawing end at `fraction`: codes at or below it show (lutyuv and cover agree). */
export function edgeOf(fraction: number): number {
  return 0.5 + Math.min(1, Math.max(0, fraction)) * 255;
}

/** How much of a pixel of code `code` shows inside the window [lo, hi] (0..1). */
export function bandAt(code: number, lo: number, hi: number): number {
  const head = Math.min(1, Math.max(0, edgeOf(hi) - (code - 0.5)));
  const tail = lo > 0 ? Math.min(1, Math.max(0, code + 0.5 - edgeOf(lo))) : 1;

  return head * tail;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

interface Field {
  dist: Float64Array;
  s: Float64Array;
  beyond: Float64Array;
  total: number;
}

interface Segment {
  a: Pt;
  b: Pt;
  s0: number;
  first: boolean;
  last: boolean;
}

function segmentsOf(subpaths: Pt[][], cum: number[][]): Segment[] {
  return subpaths.flatMap((points, i) => {
    const [first, last] = [points[0], points.at(-1) as Pt];
    // A loop whose ends meet (to float precision: a full circle) has no caps.
    const closed = points.length > 2 && Math.hypot(first.x - last.x, first.y - last.y) < 1e-6;

    return points.slice(1).map((b, j) => ({
      a: points[j],
      b,
      s0: cum[i][j],
      first: !closed && j === 0,
      last: !closed && j === points.length - 2,
    }));
  });
}

// The pixel columns of row `py` within reach of the segment: its bounding box, cut to the strip around the
// infinite line (the whole bbox row when horizontal), so the cost follows the length times the thickness.
function columnsOf(seg: Segment, spec: TraceSpec, py: number): [number, number] {
  const [dx, dy] = [seg.b.x - seg.a.x, seg.b.y - seg.a.y];
  const len = Math.hypot(dx, dy);
  const reach = spec.thickness / 2 + 1.5;
  const [bx0, bx1] = [Math.min(seg.a.x, seg.b.x) - reach - spec.x, Math.max(seg.a.x, seg.b.x) + reach - spec.x];
  const [cy, ax] = [spec.y + py + 0.5 - seg.a.y, seg.a.x - spec.x];
  const [lo, hi] =
    Math.abs(dy) < 1e-9
      ? [bx0, bx1]
      : [(cy * dx - reach * len) / dy + ax, (cy * dx + reach * len) / dy + ax].sort((m, n) => m - n);

  return [Math.max(0, Math.floor(Math.max(bx0, lo))), Math.min(spec.w - 1, Math.ceil(Math.min(bx1, hi)))];
}

// Every pixel near one straight piece of the path: keeps it when it is the nearest piece so far (ties go
// to the earlier arc length), with its arc length and, at an open end, how far past the end it lies.
function paintSegment(out: Field, seg: Segment, spec: TraceSpec): void {
  const [dx, dy] = [seg.b.x - seg.a.x, seg.b.y - seg.a.y];
  const len = Math.hypot(dx, dy);
  const reach = spec.thickness / 2 + 1.5;

  if (len < 1e-12) return;

  const y0 = Math.max(0, Math.floor(Math.min(seg.a.y, seg.b.y) - reach - spec.y));
  const y1 = Math.min(spec.h - 1, Math.ceil(Math.max(seg.a.y, seg.b.y) + reach - spec.y));

  for (let py = y0; py <= y1; py++) {
    const [x0, x1] = columnsOf(seg, spec, py);
    const cy = spec.y + py + 0.5 - seg.a.y;

    for (let px = x0; px <= x1; px++) {
      const cx = spec.x + px + 0.5 - seg.a.x;
      const along = (cx * dx + cy * dy) / len;
      const u = Math.min(len, Math.max(0, along));
      const d = Math.hypot(cx - (dx * u) / len, cy - (dy * u) / len);
      const k = py * spec.w + px;
      const s = seg.s0 + u;

      if (d > out.dist[k] + 1e-9 || (d > out.dist[k] - 1e-9 && s >= out.s[k])) continue;

      out.dist[k] = d;
      out.s[k] = s;
      out.beyond[k] = Math.max(seg.first ? -along : -Infinity, seg.last ? along - len : -Infinity);
    }
  }
}

// For every pixel: distance to the nearest piece of the path, the arc length there and how far past an open
// end it lies (butt caps; negative inside, -Infinity away from an open end).
function field(spec: TraceSpec): Field | null {
  const commands = decodeCommands(spec.path);

  if (!commands) return null;

  const traced = traceOf(flatten(commands));
  const size = spec.w * spec.h;
  const out: Field = {
    dist: new Float64Array(size).fill(Infinity),
    s: new Float64Array(size),
    beyond: new Float64Array(size),
    total: traced.total,
  };

  for (const seg of segmentsOf(traced.subpaths, traced.cum)) paintSegment(out, seg, spec);

  return out;
}

function dashAt(s: number, dash: [number, number] | undefined): number {
  if (!dash) return 1;

  const [on, off] = dash;
  const phase = s % (on + off);

  if (phase < on) return clamp01(0.5 + Math.min(phase, on - phase));

  return clamp01(0.5 - Math.min(phase - on, on + off - phase));
}

function colorOf(spec: TraceSpec): [number, number, number] {
  const hex = /^[0-9a-f]{6}$/i.test(spec.color ?? '') ? (spec.color as string) : 'ffffff';

  return [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16)) as [number, number, number];
}

interface PixelContext {
  data: Uint8Array;
  channels: number;
  rgb: [number, number, number];
  fieldValue: ReturnType<typeof field>;
  spec: TraceSpec;
  lo: number;
  hi: number;
}

function paintPixel(index: number, context: PixelContext): void {
  const { data, channels, rgb, fieldValue, spec, lo, hi } = context;

  if (channels === 4) data.set(rgb, index * 4);

  if (!fieldValue || fieldValue.total <= 0) return;

  const caps = spec.caps === 'butt' ? clamp01(0.5 - fieldValue.beyond[index]) : 1;
  const coverage =
    clamp01(spec.thickness / 2 - fieldValue.dist[index] + 0.5) * caps * dashAt(fieldValue.s[index], spec.dash);
  const code = codeOf(fieldValue.s[index] / fieldValue.total);

  if (channels === 1) {
    data[index] = coverage > 0 ? code : 0;

    return;
  }

  data[index * 4 + 3] = Math.round(255 * coverage * bandAt(code, lo, hi));
}

/** The image a spec describes: RGBA cover or grayscale code mask. */
export function traceImage(spec: TraceSpec): PngImage {
  const { w, h } = spec;
  const f = field(spec);
  const channels = spec.mode === 'code' ? 1 : 4;
  const data = new Uint8Array(w * h * channels);
  const rgb = colorOf(spec);
  const [lo, hi] = [spec.lo ?? 0, spec.hi ?? 1];
  const pixel = { data, channels, rgb, fieldValue: f, spec, lo, hi };

  for (let k = 0; k < w * h; k++) {
    paintPixel(k, pixel);
  }

  return { width: w, height: h, channels, data };
}

export function tracePng(spec: TraceSpec): Uint8Array {
  return encodePng(traceImage(spec));
}

function num(value: number): string {
  return String(Number(value.toFixed(3)));
}

/** The canonical `trace:` URL of a spec (fixed key order, the path last). */
export function traceUrl(spec: TraceSpec): string {
  const parts = [
    `mode=${spec.mode}`,
    `x=${num(spec.x)}`,
    `y=${num(spec.y)}`,
    `w=${num(spec.w)}`,
    `h=${num(spec.h)}`,
    `t=${num(spec.thickness)}`,
    `cap=${spec.caps}`,
    ...(spec.dash ? [`dash=${spec.dash.map(num).join('_')}`] : []),
    ...(spec.color ? [`c=${spec.color.replace('#', '').toLowerCase()}`] : []),
    ...(spec.lo === undefined ? [] : [`lo=${num(spec.lo)}`]),
    ...(spec.hi === undefined ? [] : [`hi=${num(spec.hi)}`]),
    `d=${spec.path}`,
  ];

  return `${SCHEME}${parts.join(',')}`;
}

function finite(text: string | undefined): number | null {
  const value = Number(text);

  return text !== undefined && text !== '' && Number.isFinite(value) ? value : null;
}

function sized(value: number | null): value is number {
  return value !== null && Number.isInteger(value) && value >= 1 && value <= MAX_DIMENSION;
}

function dashOf(text: string | undefined): [number, number] | undefined | null {
  if (text === undefined) return undefined;

  const parts = text.split('_').map(Number);

  return parts.length === 2 && parts.every((v) => Number.isFinite(v) && v > 0) ? (parts as [number, number]) : null;
}

function optional(pairs: Map<string, string>, key: string): number | undefined | null {
  return pairs.has(key) ? finite(pairs.get(key)) : undefined;
}

/** The `key=value` pairs of a generated-image URL after its scheme (shared with shape-raster.ts). */
export function urlPairs(url: string, scheme: string): Map<string, string> {
  return new Map(
    url
      .slice(scheme.length)
      .split(',')
      .map((part) => [part.slice(0, part.indexOf('=')), part.slice(part.indexOf('=') + 1)] as [string, string])
  );
}

// The image kind and caps, or null when either is unknown.
function kindsOf(pairs: Map<string, string>): Pick<TraceSpec, 'mode' | 'caps'> | null {
  const [mode, caps] = [pairs.get('mode'), pairs.get('cap')];

  return (mode === 'cover' || mode === 'code') && (caps === 'round' || caps === 'butt') ? { mode, caps } : null;
}

// The geometry fields (mode, box, thickness, caps, path), or null when one is missing or out of range.
function coreOf(pairs: Map<string, string>): Omit<TraceSpec, 'dash' | 'color' | 'lo' | 'hi'> | null {
  const kinds = kindsOf(pairs);
  const path = pairs.get('d') ?? '';
  const [x, y, w, h, thickness] = ['x', 'y', 'w', 'h', 't'].map((key) => finite(pairs.get(key)));
  const placed =
    x !== null &&
    y !== null &&
    sized(w) &&
    sized(h) &&
    thickness !== null &&
    thickness > 0 &&
    thickness <= MAX_THICKNESS;

  if (!kinds || !placed || decodeCommands(path) === null) return null;

  return { ...kinds, x, y, w, h, thickness, path };
}

// The optional fields; null when one is present but invalid.
function extrasOf(pairs: Map<string, string>): Pick<TraceSpec, 'dash' | 'color' | 'lo' | 'hi'> | null {
  const [lo, hi, dash, color] = [
    optional(pairs, 'lo'),
    optional(pairs, 'hi'),
    dashOf(pairs.get('dash')),
    pairs.get('c'),
  ];

  if (lo === null || hi === null || dash === null || (color !== undefined && !/^[0-9a-f]{6}$/.test(color))) {
    return null;
  }

  return {
    ...(dash ? { dash } : {}),
    ...(color ? { color } : {}),
    ...(lo === undefined ? {} : { lo }),
    ...(hi === undefined ? {} : { hi }),
  };
}

// Pixels a segment's band touches, upper bound (used to refuse a path before painting it).
function segmentWork(a: Pt, b: Pt, spec: TraceSpec): number {
  const reach = spec.thickness / 2 + 1.5;

  return Math.min((Math.hypot(b.x - a.x, b.y - a.y) + 2 * reach) * 2 * reach, spec.w * spec.h);
}

// Whether the path is finite, within the point limit and cheap enough to paint (a NaN total fails closed).
function affordable(spec: TraceSpec): boolean {
  const commands = decodeCommands(spec.path);
  const lines = commands && flattenWithin(commands, MAX_TRACE_POINTS);

  if (!lines || !lines.every((points) => points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)))) {
    return false;
  }

  const work = lines.reduce(
    (sum, points) => points.slice(1).reduce((n, b, j) => n + segmentWork(points[j], b, spec), sum),
    0
  );

  return work <= MAX_TRACE_WORK;
}

/** Parses a `trace:` URL back to its spec; null for any other string or an invalid / oversized spec. */
export function parseTraceUrl(url: string): TraceSpec | null {
  if (!url.startsWith(SCHEME)) return null;

  const pairs = urlPairs(url, SCHEME);
  const core = coreOf(pairs);
  const extras = extrasOf(pairs);

  if (!core || !extras) return null;

  const { path, ...rest } = core;

  const spec: TraceSpec = { ...rest, ...extras, path };

  return affordable(spec) ? spec : null;
}

/** A deterministic file name for a spec, e.g. `trace-cover-1a2b3c4d.png`. */
export function traceFileName(spec: TraceSpec): string {
  return `trace-${spec.mode}-${fnv1a32(traceUrl(spec)).toString(16).padStart(8, '0')}.png`;
}
