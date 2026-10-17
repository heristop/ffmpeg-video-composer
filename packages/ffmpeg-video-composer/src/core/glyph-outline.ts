// Glyph outlines from a TrueType (`glyf`) font: the contours of one character, flattened to polygons, for
// the compile-time mattes a transition draws through a letter (core/motion/transition-through.ts). Like
// font-metrics.ts it reads the few tables it needs with DataView only (no Buffer, no font library), so it
// runs unchanged on Node, in the browser and on React Native. CFF (`.otf`) outlines are not read.

import { readCmap, readTableDirectory, type TableRecord } from './font-metrics';

/** A point in font units, y up (the font's own axes). */
export interface OutlinePoint {
  x: number;
  y: number;
}

export interface GlyphFont {
  unitsPerEm: number;
  /** The glyph's closed contours (flattened quadratic curves), or null when the font has no glyph for it. */
  contours: (codePoint: number) => OutlinePoint[][] | null;
}

interface Tables {
  view: DataView;
  glyf: TableRecord;
  offsets: number[];
}

/** Segments per quadratic curve: plenty for a matte drawn at video sizes. */
const CURVE_STEPS = 8;
const MAX_COMPONENT_DEPTH = 4;

function readLoca(view: DataView, loca: TableRecord, longFormat: boolean, glyphs: number): number[] | null {
  const size = longFormat ? 4 : 2;

  if (loca.offset + (glyphs + 1) * size > view.byteLength) return null;

  return Array.from({ length: glyphs + 1 }, (_, i) =>
    longFormat ? view.getUint32(loca.offset + i * 4, false) : view.getUint16(loca.offset + i * 2, false) * 2
  );
}

interface RawPoint extends OutlinePoint {
  on: boolean;
}

function readFlags(view: DataView, at: number, count: number): { flags: number[]; next: number } {
  const flags: number[] = [];
  let p = at;

  while (flags.length < count) {
    const flag = view.getUint8(p++);
    flags.push(flag);

    if (flag & 8) {
      const repeat = view.getUint8(p++);

      for (let r = 0; r < repeat && flags.length < count; r++) flags.push(flag);
    }
  }

  return { flags, next: p };
}

// One axis of coordinates: short (1 byte, sign in the "same" bit) or long (2 bytes), delta-encoded.
function readCoords(view: DataView, at: number, flags: number[], shortBit: number, sameBit: number) {
  const values: number[] = [];
  let p = at;
  let value = 0;

  for (const flag of flags) {
    if (flag & shortBit) {
      const delta = view.getUint8(p++);
      value += flag & sameBit ? delta : -delta;
    }

    if (!(flag & shortBit) && !(flag & sameBit)) {
      value += view.getInt16(p, false);
      p += 2;
    }

    values.push(value);
  }

  return { values, next: p };
}

function simpleGlyph(view: DataView, at: number, contourCount: number): RawPoint[][] {
  const ends = Array.from({ length: contourCount }, (_, i) => view.getUint16(at + 10 + i * 2, false));
  const count = (ends.at(-1) ?? -1) + 1;
  const instructions = view.getUint16(at + 10 + contourCount * 2, false);
  const { flags, next } = readFlags(view, at + 12 + contourCount * 2 + instructions, count);
  const xs = readCoords(view, next, flags, 2, 16);
  const ys = readCoords(view, xs.next, flags, 4, 32);
  const points = flags.map((flag, i) => ({ x: xs.values[i], y: ys.values[i], on: (flag & 1) === 1 }));

  return ends.map((end, i) => points.slice(i === 0 ? 0 : ends[i - 1] + 1, end + 1));
}

function mid(a: OutlinePoint, b: OutlinePoint): RawPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, on: true };
}

/** The quadratic curve from `from` through control `control` to `to`, without its start point. */
function curve(from: OutlinePoint, control: OutlinePoint, to: OutlinePoint): OutlinePoint[] {
  return Array.from({ length: CURVE_STEPS }, (_, s) => {
    const t = (s + 1) / CURVE_STEPS;
    const u = 1 - t;

    return {
      x: u * u * from.x + 2 * u * t * control.x + t * t * to.x,
      y: u * u * from.y + 2 * u * t * control.y + t * t * to.y,
    };
  });
}

/** The contour starting on an on-curve point (an implied one between two off-curve points if need be). */
function onStart(raw: RawPoint[]): RawPoint[] {
  const startIndex = raw.findIndex((point) => point.on);

  if (startIndex < 0) return [mid(raw[0], raw[1] ?? raw[0]), ...raw];

  return [...raw.slice(startIndex), ...raw.slice(0, startIndex)];
}

/** Where the segment from `point` ends: on it, or past its control at the next on-point (implied or not). */
function segmentEnd(point: RawPoint, following: RawPoint): RawPoint {
  if (point.on) return point;

  return following.on ? following : mid(point, following);
}

// A contour's on/off points → a polygon: implied on-points between two off-points, curves subdivided.
function flatten(raw: RawPoint[]): OutlinePoint[] {
  if (raw.length === 0) return [];

  const ring = onStart(raw);
  const out: OutlinePoint[] = [{ x: ring[0].x, y: ring[0].y }];
  let last: OutlinePoint = ring[0];
  let i = 1;

  while (i <= ring.length) {
    const point = ring[i % ring.length];
    const following = ring[(i + 1) % ring.length];
    const end = segmentEnd(point, following);

    out.push(...(point.on ? [{ x: point.x, y: point.y }] : curve(last, point, end)));
    last = end;
    i += !point.on && following.on ? 2 : 1;
  }

  out.pop();

  return out;
}

interface Component {
  glyph: number;
  dx: number;
  dy: number;
  matrix: [number, number, number, number];
}

function f2dot14(view: DataView, at: number): number {
  return view.getInt16(at, false) / 16384;
}

function componentScale(view: DataView, at: number, flags: number): { matrix: Component['matrix']; size: number } {
  if (flags & 8) return { matrix: [f2dot14(view, at), 0, 0, f2dot14(view, at)], size: 2 };

  if (flags & 0x40) return { matrix: [f2dot14(view, at), 0, 0, f2dot14(view, at + 2)], size: 4 };

  if (flags & 0x80) {
    const m = [0, 2, 4, 6].map((k) => f2dot14(view, at + k));

    return { matrix: [m[0], m[1], m[2], m[3]], size: 8 };
  }

  return { matrix: [1, 0, 0, 1], size: 0 };
}

function components(view: DataView, at: number): Component[] {
  const out: Component[] = [];
  let p = at + 10;
  let more = true;

  while (more) {
    const flags = view.getUint16(p, false);
    const glyph = view.getUint16(p + 2, false);
    const words = (flags & 1) === 1;
    const dx = words ? view.getInt16(p + 4, false) : view.getInt8(p + 4);
    const dy = words ? view.getInt16(p + 6, false) : view.getInt8(p + 5);
    const scale = componentScale(view, p + (words ? 8 : 6), flags);

    // Point-matched placement (ARGS_ARE_XY_VALUES unset) is rare in Latin faces: placed at the origin.
    out.push({ glyph, dx: flags & 2 ? dx : 0, dy: flags & 2 ? dy : 0, matrix: scale.matrix });
    p += (words ? 8 : 6) + scale.size;
    more = (flags & 0x20) !== 0;
  }

  return out;
}

function glyphContours(tables: Tables, glyph: number, depth: number): OutlinePoint[][] {
  const { view, glyf, offsets } = tables;
  const start = offsets.at(glyph);
  const end = offsets.at(glyph + 1);

  if (start === undefined || end === undefined || end <= start || depth > MAX_COMPONENT_DEPTH) return [];

  const at = glyf.offset + start;
  const contourCount = view.getInt16(at, false);

  if (contourCount >= 0) return simpleGlyph(view, at, contourCount).map(flatten);

  return components(view, at).flatMap((component) => {
    const [a, b, c, d] = component.matrix;

    return glyphContours(tables, component.glyph, depth + 1).map((contour) =>
      contour.map((point) => ({
        x: a * point.x + c * point.y + component.dx,
        y: b * point.x + d * point.y + component.dy,
      }))
    );
  });
}

/** The outlines of a TrueType font, or null when it is not one this reader understands. */
export function parseGlyphOutlines(bytes: Uint8Array): GlyphFont | null {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tables = readTableDirectory(view, bytes);
    const [head, maxp, loca, glyf, cmap] = ['head', 'maxp', 'loca', 'glyf', 'cmap'].map((tag) => tables?.get(tag));

    if (!head || !maxp || !loca || !glyf || !cmap) return null;

    const unitsPerEm = view.getUint16(head.offset + 18, false);
    const offsets = readLoca(
      view,
      loca,
      view.getInt16(head.offset + 50, false) === 1,
      view.getUint16(maxp.offset + 4, false)
    );
    const charToGlyph = readCmap(view, cmap);

    if (!offsets || unitsPerEm === 0 || charToGlyph.size === 0) return null;

    return {
      unitsPerEm,
      contours: (codePoint) => {
        const glyph = charToGlyph.get(codePoint);

        return glyph === undefined ? null : glyphContours({ view, glyf, offsets }, glyph, 0);
      },
    };
  } catch {
    return null;
  }
}
