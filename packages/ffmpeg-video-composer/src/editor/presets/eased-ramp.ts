// The eased 0→1 ramp every animated entrance, exit and overlay motion is built from. The four historical
// easings keep their compact closed-form strings; every other curve (springs, cubic-bezier, the named
// set, points) goes through the curve engine in
// core/motion/hermite.ts. Split out of text.ts, which re-exports easeRampExpr, for its line budget.

import { isLegacyEasing, parseEasing, type EasingSpec } from '@/core/motion/easing';
import { easedProgressExpr } from '@/core/motion/hermite';

// Minimal decimal rendering: 0.3 → "0.3", 0.9 → "0.9", avoiding 0.1+0.2 → "0.30000000000000004".
export function num(value: number): string {
  return Number(value.toFixed(4)).toString();
}

// 0 before `delay`, a linear 0→1 ramp across `duration`, then 1 — the shape of both the alpha
// fade-in and the motion progress. Unquoted; callers wrap it.
export function ramp(delay: number, duration: number): string {
  const end = num(delay + duration);

  return `if(lt(t,${num(delay)}),0,if(lt(t,${end}),(t-${num(delay)})/${num(duration)},1))`;
}

/**
 * Wraps a 0→1 ramp expression `p` in a legacy easing curve: ease-out = 1-(1-p)^3 (decelerates into
 * place), ease-in-out = smoothstep p*p*(3-2p); ease-out-back briefly overshoots travel. This pure
 * expression math adds no filter, so it is LGPL-safe on the on-device build. Linear or unset easing
 * returns the ramp unchanged.
 */
export function easeRampExpr(rampExpr: string, easing: EasingSpec | undefined): string {
  if (easing === 'ease-out-back') return `(${rampExpr})*(1+((${rampExpr})-1)*(2.70158*((${rampExpr})-1)-1))`;

  if (easing === 'ease-out') return `1-pow(1-(${rampExpr}),3)`;

  if (easing === 'ease-in-out') return `(${rampExpr})*(${rampExpr})*(3-2*(${rampExpr}))`;

  return rampExpr;
}

/** The eased ramp over [delay, delay + duration] for any easing spec. */
export function easedRamp(delay: number, duration: number, easing: EasingSpec | undefined): string {
  if (easing === undefined || isLegacyEasing(easing)) return easeRampExpr(ramp(delay, duration), easing);

  return easedProgressExpr(parseEasing(easing), { delay, duration });
}

/**
 * The duration a phase takes when none is authored: a spring's own settle time (physics decides),
 * otherwise the caller's default.
 */
export function phaseDuration(authored: number | undefined, easing: EasingSpec | undefined, fallback: number): number {
  if (authored !== undefined) return authored;

  if (easing === undefined || isLegacyEasing(easing)) return fallback;

  return parseEasing(easing).settle ?? fallback;
}

/**
 * Alpha must stay in 0..1 while position overshoots: clamp any curve that can leave the unit range. The
 * historical curves keep their historical form (only ease-out-back was clamped).
 */
export function alphaRampExpr(expr: string, easing: EasingSpec | undefined): string {
  if (easing === undefined || easing === 'linear' || easing === 'ease-out' || easing === 'ease-in-out') return expr;

  return `clip((${expr}),0,1)`;
}
