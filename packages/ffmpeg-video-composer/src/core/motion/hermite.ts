// Lowers any Curve to an FFmpeg expression in time (docs/plans/motion-system.md §2.1).
//
// The curve is sampled at compile time and approximated by a piecewise cubic Hermite polynomial whose
// pieces are expressed directly in `t` (seconds), not in progress. Every piece is then a Horner-form
// cubic in (t − tᵢ), joined by `if(lt(t,…))`: no `st/ld` registers, no `;`, no transcendental calls,
// so springs, beziers and elastic curves all cost a few multiply-adds per frame, read the same on every
// backend, and stay inside the expression subset the engine's own geometry evaluator understands.
// Segmentation is adaptive: a piece splits until it stays within TOLERANCE of the true curve.
//
// An animation must also settle: where the true curve runs one way across a piece, the piece's slopes are
// limited (Fritsch–Carlson) so its cubic never turns back nor passes its ends, and a curve that stays in
// 0..1 is clipped to it. Overlay and drawtext truncate positions to whole pixels, so an ease-out whose fit
// dipped a millionth past its end drew its layer a pixel off on the frame before it landed.

import type { Curve, CurveFn } from './curves';

/** Max deviation of the emitted polynomial from the true curve, in progress units (0.1%). */
export const TOLERANCE = 0.001;
// Depth 10 bounds a piece at 1/1024 of the window; only singular corners (circ, bounce) go that deep.
const MAX_DEPTH = 10;
const PROBES = 8;
// Slopes are finite differences over a fraction of the piece: robust where the true derivative is
// infinite (ease-out-circ at 0) or jumps (bounce), and never straddles the window-end snap.
const SLOPE_FRACTION = 1 / 16;

export interface Window {
  /** Seconds from the start of the stream when the motion starts. */
  delay: number;
  /** Seconds the motion takes. */
  duration: number;
}

interface Piece {
  a: number;
  b: number;
}

// Fixed-point rendering: FFmpeg reads exponent notation, the engine's geometry evaluator does not,
// and a stable textual form keeps filtergraph goldens readable.
export function fmt(value: number): string {
  const fixed = Number(value.toFixed(6));

  return Object.is(fixed, -0) ? '0' : fixed.toString();
}

// Central difference inside the window, one-sided (inward) at its edges.
function slope(fn: CurveFn, p: number, width: number): number {
  const h = width * SLOPE_FRACTION;
  const lo = Math.max(0, p - h);
  const hi = Math.min(1, p + h);

  return (fn(hi) - fn(lo)) / (hi - lo);
}

// Whether the true curve runs one way only across the piece (or holds still), probed like the fit.
function monotoneOn(fn: CurveFn, { a, b }: Piece): boolean {
  const y0 = fn(a);
  const delta = fn(b) - y0;
  let previous = y0;

  for (let i = 1; i <= PROBES; i++) {
    const value = fn(a + ((b - a) * i) / PROBES);

    if ((value - previous) * delta < 0 || (delta === 0 && value !== y0)) return false;

    previous = value;
  }

  return true;
}

// Fritsch–Carlson: end slopes against the secant, kept on its side and inside the circle of radius 3, keep
// a cubic Hermite piece monotone and between its end values.
function limited(m0: number, m1: number, secant: number): [number, number] {
  if (secant === 0) return [0, 0];

  const alpha = Math.max(0, m0 / secant);
  const beta = Math.max(0, m1 / secant);
  const radius = Math.hypot(alpha, beta);
  const tau = radius > 3 ? 3 / radius : 1;

  return [alpha * tau * secant, beta * tau * secant];
}

// The piece's end slopes in progress per unit of p, limited where the true curve is monotone.
function pieceSlopes(fn: CurveFn, piece: Piece): [number, number] {
  const width = piece.b - piece.a;
  const m0 = slope(fn, piece.a, width);
  const m1 = slope(fn, piece.b, width);

  if (!monotoneOn(fn, piece)) return [m0, m1];

  return limited(m0, m1, (fn(piece.b) - fn(piece.a)) / width);
}

function hermite(fn: CurveFn, piece: Piece, p: number): number {
  const { a, b } = piece;
  const width = b - a;
  const u = (p - a) / width;
  const slopes = pieceSlopes(fn, piece);
  const [y0, y1, m0, m1] = [fn(a), fn(b), slopes[0] * width, slopes[1] * width];

  return (
    (2 * u ** 3 - 3 * u ** 2 + 1) * y0 +
    (u ** 3 - 2 * u ** 2 + u) * m0 +
    (-2 * u ** 3 + 3 * u ** 2) * y1 +
    (u ** 3 - u ** 2) * m1
  );
}

function fits(fn: CurveFn, piece: Piece): boolean {
  for (let i = 1; i < PROBES; i++) {
    const p = piece.a + ((piece.b - piece.a) * i) / PROBES;

    if (Math.abs(hermite(fn, piece, p) - fn(p)) > TOLERANCE) return false;
  }

  return true;
}

/** Adaptive split of [0, 1] into pieces that each fit within TOLERANCE. */
export function segment(fn: CurveFn): Piece[] {
  const pieces: Piece[] = [];
  const stack: Array<Piece & { depth: number }> = [{ a: 0, b: 1, depth: 0 }];

  while (stack.length > 0) {
    const piece = stack.pop() as Piece & { depth: number };

    if (piece.depth >= MAX_DEPTH || (piece.depth >= 1 && fits(fn, piece))) {
      pieces.push(piece);

      continue;
    }

    const mid = (piece.a + piece.b) / 2;
    stack.push({ a: mid, b: piece.b, depth: piece.depth + 1 }, { a: piece.a, b: mid, depth: piece.depth + 1 });
  }

  return pieces;
}

// One piece as a cubic in (t − t₀): c0 + u·(c1 + u·(c2 + u·c3)), coefficients per second.
function pieceExpr(fn: CurveFn, piece: Piece, window: Window, time: string): string {
  const span = (piece.b - piece.a) * window.duration;
  const t0 = window.delay + piece.a * window.duration;
  const y0 = fn(piece.a);
  const y1 = fn(piece.b);
  const [m0, m1] = pieceSlopes(fn, piece).map((m) => m / window.duration);
  const c2 = (3 * (y1 - y0)) / span ** 2 - (2 * m0 + m1) / span;
  const c3 = (m0 + m1) / span ** 2 - (2 * (y1 - y0)) / span ** 3;
  const u = `(${time}-${fmt(t0)})`;

  return `${fmt(y0)}+${u}*(${fmt(m0)}+${u}*(${fmt(c2)}+${u}*${fmt(c3)}))`;
}

// Stepped curves are exact: floor/ceil of the linear progress, no approximation.
function stepsExpr(steps: NonNullable<Curve['steps']>, window: Window, time: string): string {
  const progress = `(${time}-${fmt(window.delay)})/${fmt(window.duration)}`;
  const round = steps.position === 'end' ? 'floor' : 'ceil';

  return `${round}((${progress})*${steps.count})/${steps.count}`;
}

/**
 * The eased progress of `curve` over `window`, as an FFmpeg expression in `time`: 0 before the window,
 * the curve across it, exactly 1 after it. Springs and back/elastic curves overshoot inside the window.
 */
export function easedProgressExpr(curve: Curve, window: Window, time = 't'): string {
  const end = fmt(window.delay + window.duration);
  const start = `if(lt(${time},${fmt(window.delay)}),0,`;

  if (curve.steps) return `${start}if(lt(${time},${end}),${stepsExpr(curve.steps, window, time)},1))`;

  const pieces = segment(curve.fn);
  let body = '1';

  for (let i = pieces.length - 1; i >= 0; i--) {
    const bound = i === pieces.length - 1 ? end : fmt(window.delay + pieces[i].b * window.duration);
    body = `if(lt(${time},${bound}),${pieceExpr(curve.fn, pieces[i], window, time)},${body})`;
  }

  return `${start}${withinUnit(curve.fn) ? `clip(${body},0,1)` : body})`;
}

// Whether the curve stays in 0..1 (no overshoot, no anticipation): its fit, rounded to six decimals, may
// then be clipped to it.
function withinUnit(fn: CurveFn): boolean {
  for (let i = 0; i <= 1024; i++) {
    const value = fn(i / 1024);

    if (value < 0 || value > 1) return false;
  }

  return true;
}
