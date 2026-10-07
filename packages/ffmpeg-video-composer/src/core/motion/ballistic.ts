// Closed-form ballistic flight with linear drag, gravity and a lateral sway: the path of a light piece of
// paper (fx confetti) as a function of time, both as numbers (tests, planning) and as an FFmpeg expression
// of a time variable (an overlay's per-frame x/y). Linear drag gives an exact solution, so a frame's
// position never depends on the previous frame (no integration, no drift, any frame renders alone):
//
//   v(T) = (v0 - g/k)·e^(-kT) + g/k          (terminal velocity g/k downward)
//   p(T) = p0 + (v0 - g/k)·(1 - e^(-kT))/k + (g/k)·T
//
// x has no gravity; it gains `sway·sin(2π·swayRate·T + swayPhase)`. Units are the caller's (px and s).

import { fmt } from './hermite';

export interface Ballistic {
  x0: number;
  y0: number;
  /** Launch velocity, units per second (y grows downward). */
  vx: number;
  vy: number;
  /** Downward acceleration, units per s². */
  gravity: number;
  /** Linear drag rate per second (> 0). */
  drag: number;
  /** Lateral sway amplitude (units), rate (Hz) and phase (radians). */
  sway: number;
  swayRate: number;
  swayPhase: number;
}

/** Position at `T` seconds after launch. */
export function ballisticAt(b: Ballistic, T: number): { x: number; y: number } {
  const k = Math.max(1e-6, b.drag);
  const decay = (1 - Math.exp(-k * T)) / k;
  const terminal = b.gravity / k;

  return {
    x: b.x0 + b.vx * decay + b.sway * Math.sin(2 * Math.PI * b.swayRate * T + b.swayPhase),
    y: b.y0 + (b.vy - terminal) * decay + terminal * T,
  };
}

/** Velocity at `T` seconds after launch (the sway excluded). */
export function ballisticVelocity(b: Ballistic, T: number): { vx: number; vy: number } {
  const k = Math.max(1e-6, b.drag);
  const terminal = b.gravity / k;

  return { vx: b.vx * Math.exp(-k * T), vy: (b.vy - terminal) * Math.exp(-k * T) + terminal };
}

/** The highest point (smallest y) of the flight, and when it is reached (0 when launched downward). */
export function ballisticApex(b: Ballistic): { T: number; y: number } {
  const k = Math.max(1e-6, b.drag);
  const terminal = b.gravity / k;
  const T = b.vy < 0 && terminal > 0 ? Math.log((terminal - b.vy) / terminal) / k : 0;

  return { T, y: ballisticAt(b, T).y };
}

/**
 * The position as FFmpeg expressions of `time` (an expression such as `(t-1.2)`, clamped to ≥ 0 by the
 * caller or by the expression). Coefficients are folded at compile time, so each axis is one short term.
 */
export function ballisticExpr(b: Ballistic, time: string): { x: string; y: string } {
  const k = Math.max(1e-6, b.drag);
  const terminal = b.gravity / k;
  const decay = `(1-exp(-${fmt(k)}*${time}))`;
  const sway =
    b.sway === 0
      ? ''
      : `+${fmt(b.sway)}*sin(${fmt(2 * Math.PI * b.swayRate)}*${time}+${fmt(b.swayPhase % (2 * Math.PI))})`;

  return {
    x: `${fmt(b.x0)}+${fmt(b.vx / k)}*${decay}${sway}`,
    y: `${fmt(b.y0)}+${fmt((b.vy - terminal) / k)}*${decay}+${fmt(terminal)}*${time}`,
  };
}
