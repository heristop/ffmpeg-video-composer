// The easing vocabulary (docs/plans/motion-system.md §2.1), as plain functions of progress
// p ∈ [0, 1]. Nothing here emits FFmpeg syntax: hermite.ts samples these curves at compile time and
// lowers them to a piecewise polynomial in time, so every curve costs the same at render time and runs
// on every backend (no filter, only expression arithmetic).

export type CurveFn = (p: number) => number;

export interface Curve {
  fn: CurveFn;
  /** Natural duration in seconds (springs): the time the motion takes to settle within 0.1%. */
  settle?: number;
  /** Discrete steps: lowered exactly with floor/ceil, never approximated. */
  steps?: { count: number; position: 'start' | 'end' };
}

export interface SpringParams {
  stiffness: number;
  damping: number;
  mass?: number;
  /** Initial velocity toward the target, in normalized distance per second. */
  velocity?: number;
}

// ── named curves ───────────────────────────────────────────────────────────────

const C1 = 1.70158;
const C2 = C1 * 1.525;
const C3 = C1 + 1;

function bounceOut(p: number): number {
  const n = 7.5625;
  const d = 2.75;

  if (p < 1 / d) return n * p * p;

  if (p < 2 / d) return n * (p - 1.5 / d) ** 2 + 0.75;

  if (p < 2.5 / d) return n * (p - 2.25 / d) ** 2 + 0.9375;

  return n * (p - 2.625 / d) ** 2 + 0.984375;
}

export const NAMED_CURVES: Readonly<Record<string, CurveFn>> = {
  linear: (p) => p,
  'ease-in-cubic': (p) => p ** 3,
  'ease-out-cubic': (p) => 1 - (1 - p) ** 3,
  'ease-in-out-cubic': (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2),
  'ease-out-quart': (p) => 1 - (1 - p) ** 4,
  'ease-out-quint': (p) => 1 - (1 - p) ** 5,
  'ease-out-expo': (p) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p)),
  'ease-in-out-expo': (p) => {
    if (p <= 0 || p >= 1) return p <= 0 ? 0 : 1;

    return p < 0.5 ? 2 ** (20 * p - 10) / 2 : (2 - 2 ** (-20 * p + 10)) / 2;
  },
  'ease-in-out-sine': (p) => -(Math.cos(Math.PI * p) - 1) / 2,
  'ease-out-sine': (p) => Math.sin((Math.PI * p) / 2),
  'ease-out-circ': (p) => Math.sqrt(1 - (p - 1) ** 2),
  'ease-in-back': (p) => C3 * p ** 3 - C1 * p ** 2,
  'ease-in-out-back': (p) =>
    p < 0.5 ? ((2 * p) ** 2 * ((C2 + 1) * 2 * p - C2)) / 2 : ((2 * p - 2) ** 2 * ((C2 + 1) * (p * 2 - 2) + C2) + 2) / 2,
  'ease-out-elastic': (p) => {
    if (p <= 0 || p >= 1) return p <= 0 ? 0 : 1;

    return 2 ** (-10 * p) * Math.sin((p * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  },
  'ease-out-bounce': bounceOut,
};

// CSS keyword curves, defined (as in CSS) by their cubic-bezier control points.
export const CSS_BEZIERS: Readonly<Record<string, readonly [number, number, number, number]>> = {
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
};

// ── cubic-bezier ───────────────────────────────────────────────────────────────

function bezierAxis(a: number, b: number, s: number): number {
  return 3 * a * s * (1 - s) ** 2 + 3 * b * s ** 2 * (1 - s) + s ** 3;
}

function bezierAxisSlope(a: number, b: number, s: number): number {
  return 3 * a * (1 - s) ** 2 + 6 * (b - a) * s * (1 - s) + 3 * (1 - b) * s ** 2;
}

// Bezier parameter s whose x equals p: Newton–Raphson, falling back to bisection where the slope
// flattens (x control points at 0 or 1), so the solve always converges.
function solveBezierX(x1: number, x2: number, p: number): number {
  let s = p;

  for (let i = 0; i < 8; i++) {
    const slope = bezierAxisSlope(x1, x2, s);
    const error = bezierAxis(x1, x2, s) - p;

    if (Math.abs(error) < 1e-9) return s;

    if (Math.abs(slope) < 1e-6) break;

    s = Math.min(1, Math.max(0, s - error / slope));
  }

  let lo = 0;
  let hi = 1;

  for (let i = 0; i < 60; i++) {
    s = (lo + hi) / 2;

    if (bezierAxis(x1, x2, s) < p) {
      lo = s;

      continue;
    }

    hi = s;
  }

  return s;
}

/** CSS `cubic-bezier(x1, y1, x2, y2)`; x1/x2 must lie in [0, 1], y may overshoot. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): CurveFn {
  return (p) => {
    if (p <= 0 || p >= 1) return p <= 0 ? 0 : 1;

    return bezierAxis(y1, y2, solveBezierX(x1, x2, p));
  };
}

// ── spring ─────────────────────────────────────────────────────────────────────

/**
 * Closed-form damped harmonic oscillator, released at distance 1 from its target: returns the eased
 * position (0 → 1) at `seconds`. Under-, critically and over-damped regimes are all exact.
 */
export function springPosition(params: SpringParams, seconds: number): number {
  const mass = params.mass ?? 1;
  const v0 = params.velocity ?? 0;
  const w0 = Math.sqrt(params.stiffness / mass);
  const zeta = params.damping / (2 * Math.sqrt(params.stiffness * mass));

  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    const b = (zeta * w0 - v0) / wd;

    return 1 - Math.exp(-zeta * w0 * seconds) * (Math.cos(wd * seconds) + b * Math.sin(wd * seconds));
  }

  if (zeta === 1) return 1 - (1 + (w0 - v0) * seconds) * Math.exp(-w0 * seconds);

  const root = Math.sqrt(zeta * zeta - 1);
  const r1 = -w0 * (zeta - root);
  const r2 = -w0 * (zeta + root);
  const c2 = (-v0 - r1) / (r2 - r1);

  return 1 - ((1 - c2) * Math.exp(r1 * seconds) + c2 * Math.exp(r2 * seconds));
}

const SETTLE_TOLERANCE = 0.001;
const MAX_SETTLE_SECONDS = 10;

/** Seconds until the spring stays within 0.1% of its target (capped at 10 s). */
export function springSettleTime(params: SpringParams): number {
  const step = 1 / 600;
  let last = 0;

  for (let t = 0; t <= MAX_SETTLE_SECONDS; t += step) {
    if (Math.abs(1 - springPosition(params, t)) >= SETTLE_TOLERANCE) last = t;
  }

  return Math.min(MAX_SETTLE_SECONDS, Number((last + step).toFixed(4)));
}

/**
 * A spring as a progress curve: its settle time maps onto p ∈ [0, 1], so a spring fills whatever
 * duration it is given, and reports `settle` as its natural duration for callers that let physics
 * decide. The curve stays continuous up to p = 1 (within 0.1% of the target there); the lowered
 * expression lands exactly on 1 once the window ends.
 */
export function springCurve(params: SpringParams): Curve {
  const settle = springSettleTime(params);

  return { fn: (p) => springPosition(params, p * settle), settle };
}

// ── points ─────────────────────────────────────────────────────────────────────

/** Monotone-in-x control points `[[p, value], …]` from (0, 0) to (1, 1), linearly interpolated. */
export function pointsCurve(points: ReadonlyArray<readonly [number, number]>): CurveFn {
  return (p) => {
    if (p <= points[0][0]) return points[0][1];

    for (let i = 1; i < points.length; i++) {
      const [x1, y1] = points[i];
      const [x0, y0] = points[i - 1];

      if (p <= x1) return x1 === x0 ? y1 : y0 + ((p - x0) / (x1 - x0)) * (y1 - y0);
    }

    return points.at(-1)?.[1] ?? 1;
  };
}
