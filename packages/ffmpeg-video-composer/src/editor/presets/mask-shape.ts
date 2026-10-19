// Mask shapes as path commands (path-geometry.ts) and where their grey image sits: over the shape's bounds
// plus room for the feather. Pure and bounded: a path goes through the path graphic's linear tokenizer, its
// flattened size is estimated from the control polygon BEFORE anything is flattened (flatten() makes one
// point per 1.5 px of control-polygon length), and a shape too detailed or too large is refused with a reason.

import { MAX_D } from '../../schemas/graphics-path.schemas';
import type { MaskShape } from '../../schemas/mask.schemas';
import { flatten, type PathCommand, type Pt } from './path-geometry';
import { encodeCommands, parseSvgPath } from './path-svg';

export const MAX_MASK_SIDE = 4096;
export const MAX_MASK_POINTS = 16_384;
/** Most pixels one mask image may hold: half of a full MAX_MASK_SIDE square. */
export const MAX_MASK_PIXELS = (MAX_MASK_SIDE * MAX_MASK_SIDE) / 2;
/** Longest encoded path a mask carries. An authored `d` is at most MAX_D characters; its commands re-encode
 * absolute with up to 3 decimals (an `H` of 2 characters becomes about 20), so 16× covers every legitimate one. */
export const MAX_ENCODED_PATH = MAX_D * 16;
const KAPPA = 0.5522847498;
const STEP = 1.5;
const MAX_STEPS = 4096;
const RAD = Math.PI / 180;

export interface PlacedMask {
  /** Top-left of the mask image in frame px (may lie outside the frame). */
  x: number;
  y: number;
  w: number;
  h: number;
  feather: number;
  /** The shape's commands relative to the image, encoded (path-svg.ts encodeCommands). */
  path: string;
}

export type MaskPlacement =
  | { ok: true; mask: PlacedMask }
  | { ok: false; code: 'mask_path_invalid' | 'mask_too_large'; message: string };

/** Box-blur radius of a feather: three passes of it ramp over about `feather` px (mask-raster.ts). */
export function featherRadius(feather: number): number {
  return feather > 0 ? Math.max(1, Math.round(feather / 2.5)) : 0;
}

/** Margin around the shape: the blur's full reach plus one pixel of anti-aliasing. */
export function featherPad(feather: number): number {
  return 3 * featherRadius(feather) + 1;
}

function rectCommands(shape: Extract<MaskShape, { type: 'rect' }>): PathCommand[] {
  const { x, y, w, h } = shape;
  const r = Math.min(shape.radius ?? 0, w / 2, h / 2);

  if (r <= 0) return [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']];

  const c = r * (1 - KAPPA);

  return [
    ['M', x + r, y],
    ['L', x + w - r, y],
    ['C', x + w - c, y, x + w, y + c, x + w, y + r],
    ['L', x + w, y + h - r],
    ['C', x + w, y + h - c, x + w - c, y + h, x + w - r, y + h],
    ['L', x + r, y + h],
    ['C', x + c, y + h, x, y + h - c, x, y + h - r],
    ['L', x, y + r],
    ['C', x, y + c, x + c, y, x + r, y],
    ['Z'],
  ];
}

/** The shape as canonical commands in frame px; null for a path that does not parse. */
export function maskShapeCommands(shape: MaskShape): PathCommand[] | null {
  if (shape.type === 'rect') return rectCommands(shape);

  if (shape.type === 'ellipse') return [['E', shape.cx, shape.cy, shape.rx, shape.ry, 0, 360]];

  return parseSvgPath(shape.d);
}

const PAIRS: Partial<Record<string, number>> = { M: 1, L: 1, C: 3, Q: 2, E: 1, W: 1 };

/** The commands moved by (dx, dy): every point of M/L/C/Q, the centre (first pair) of E/W. */
export function translateCommands(commands: readonly PathCommand[], dx: number, dy: number): PathCommand[] {
  return commands.map((command) => {
    const [kind, ...args] = command as [string, ...number[]];
    const moved = 2 * (PAIRS[kind] ?? 0);

    return [kind, ...args.map((v, i) => (i < moved ? v + (i % 2 === 0 ? dx : dy) : v))] as PathCommand;
  });
}

function distance(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

// flatten()'s own step rule (path-geometry.ts steps()): one point per 1.5 px, at least `min`, at most 4096.
function steps(length: number, min = 1): number {
  return Math.min(MAX_STEPS, Math.max(min, Math.ceil(length / STEP)));
}

function at(x: number, y: number): Pt {
  return { x, y };
}

// Where flatten()'s pen is: its position, whether a subpath is open, and where that subpath started.
interface PenState {
  at: Pt;
  start: Pt;
  open: boolean;
}

// An E/W shape joins the open subpath when the pen already sits on its first point, else starts one there.
function joined(pen: PenState, first: Pt, last: Pt): PenState {
  const joins = pen.open && distance(pen.at, first) <= 1e-6;

  return { at: last, start: joins ? pen.start : first, open: true };
}

// Points of an E (arc) or W (wave), refused (NaN) unless every radius, width and wavelength is positive.
function shapeCount(kind: string, c: number[], pen: PenState): [number, PenState] {
  if (kind === 'E') {
    const [cx, cy, rx, ry, from, sweep] = c;
    const n = steps(Math.abs(sweep * RAD) * Math.max(rx, ry), 4);
    function edge(angle: number): Pt {
      return at(cx + rx * Math.cos(angle * RAD), cy + ry * Math.sin(angle * RAD));
    }

    return rx > 0 && ry > 0 ? [n + 1, joined(pen, edge(from), edge(from + sweep))] : [Number.NaN, pen];
  }

  const [x0, y0, width, amplitude, wavelength, phase] = c;
  const n = steps(width * (1 + (2 * Math.PI * Math.abs(amplitude)) / wavelength), 8);
  function edge(x: number): Pt {
    return at(x, y0 - amplitude * Math.sin((2 * Math.PI * (x - x0)) / wavelength + phase * RAD));
  }

  return width > 0 && wavelength > 0 ? [n + 1, joined(pen, edge(x0), edge(x0 + width))] : [Number.NaN, pen];
}

// Exactly the points flatten() makes for one command, and the pen after it.
function countOf(command: PathCommand, pen: PenState): [number, PenState] {
  const [kind, ...c] = command as [string, ...number[]];
  const points = pointsOf(c);
  // A line or curve drawn after a close (or first) re-adds the subpath start.
  const reopen = pen.open ? 0 : 1;

  if (kind === 'M') return [1, { at: points[0], start: points[0], open: true }];

  if (kind === 'L') return [1 + reopen, { ...pen, at: points[0], open: true }];

  if (kind === 'Z') return [1, { at: pen.start, start: pen.start, open: false }];

  if (kind === 'C' || kind === 'Q') {
    const route = [pen.at, ...points];
    const length = route.slice(1).reduce((sum, p, i) => sum + distance(route[i], p), 0);

    return [steps(length) + reopen, { ...pen, at: points.at(-1) as Pt, open: true }];
  }

  return shapeCount(kind, c, pen);
}

function pointsOf(args: readonly number[]): Pt[] {
  return Array.from({ length: Math.floor(args.length / 2) }, (_, i) => at(args[2 * i], args[2 * i + 1]));
}

/**
 * The number of points flatten() makes for the commands, counted with its own step rule (so a bound, not an
 * estimate). NaN for a non-positive radius, width or wavelength or any non-finite term: it never passes a `<=`.
 */
export function pointBudget(commands: readonly PathCommand[]): number {
  let pen: PenState = { at: at(0, 0), start: at(0, 0), open: false };
  let total = 0;

  for (const command of commands) {
    const [count, next] = countOf(command, pen);

    [total, pen] = [total + count, next];
  }

  return total;
}

/**
 * flatten(), but gives up (null) as soon as more than `max` points exist. The commands are flattened one
 * subpath at a time (each M starts one), so a flood stops after the chunk that crosses the bound.
 */
export function flattenWithin(commands: readonly PathCommand[], max: number): Pt[][] | null {
  const starts = commands.flatMap((command, i) => (command[0] === 'M' && i > 0 ? [i] : []));
  const chunks = [0, ...starts].map((from, k) => commands.slice(from, starts[k]));
  const out: Pt[][] = [];
  let total = 0;

  for (const chunk of chunks) {
    const subpaths = flatten(chunk);

    total += subpaths.reduce((sum, points) => sum + points.length, 0);

    if (!(total <= max)) return null;

    out.push(...subpaths);
  }

  return out;
}

interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// The bounds of the subpaths that can enclose area (3 points or more); null when none can or any is non-finite.
function boundsOf(subpaths: Pt[][]): Bounds | null {
  const points = subpaths.filter((subpath) => subpath.length > 2).flat();

  if (points.length === 0 || !points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return null;

  const b: Bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };

  for (const p of points) {
    [b.x0, b.y0, b.x1, b.y1] = [Math.min(b.x0, p.x), Math.min(b.y0, p.y), Math.max(b.x1, p.x), Math.max(b.y1, p.y)];
  }

  return b;
}

function invalid(message: string): MaskPlacement {
  return { ok: false, code: 'mask_path_invalid', message };
}

/** Where the commands' image sits and what it holds; refused when it cannot be filled within the bounds. */
export function placeCommands(commands: readonly PathCommand[], feather = 0): MaskPlacement {
  if (!(pointBudget(commands) <= MAX_MASK_POINTS)) {
    return invalid(`the path is too detailed to fill (over ${MAX_MASK_POINTS} points once flattened); simplify it`);
  }

  const subpaths = flattenWithin(commands, MAX_MASK_POINTS);
  const bounds = subpaths && boundsOf(subpaths);

  if (!bounds) return invalid('the shape encloses no area, or has a non-finite coordinate');

  const pad = featherPad(feather);
  const [x, y] = [Math.floor(bounds.x0) - pad, Math.floor(bounds.y0) - pad];
  const [w, h] = [Math.ceil(bounds.x1) + pad - x, Math.ceil(bounds.y1) + pad - y];

  if (w > MAX_MASK_SIDE || h > MAX_MASK_SIDE || w * h > MAX_MASK_PIXELS) {
    const message = `the mask needs a ${w}×${h} px image; keep it within ${MAX_MASK_SIDE} px a side and ${MAX_MASK_PIXELS} px in all`;

    return { ok: false, code: 'mask_too_large', message };
  }

  const path = encodeCommands(translateCommands(commands, -x, -y));

  if (path.length > MAX_ENCODED_PATH) return invalid('the path is too long once encoded; simplify it');

  return { ok: true, mask: { x, y, w, h, feather, path } };
}

/** Where the shape's image sits and what it holds; refused when it cannot be filled within the bounds. */
export function placeMask(shape: MaskShape, feather = 0): MaskPlacement {
  if (shape.type === 'path' && shape.d.length > MAX_D) return invalid(`\`d\` is longer than ${MAX_D} characters`);

  const commands = maskShapeCommands(shape);

  if (!commands) return invalid('`d` is not a well-formed path of M, L, H, V, C, Q and Z commands');

  return placeCommands(commands, feather);
}
