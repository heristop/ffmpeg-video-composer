// `animate` keyframe tracks → drawtext expressions (docs/plans/motion-system.md §3).
//
// A track is a list of keys; each key eases INTO itself from the previous one. The value is lowered as a
// sum of eased steps, v(t) = v₀ + Σᵢ (vᵢ − vᵢ₋₁)·Eᵢ(t), where Eᵢ is key i's eased progress over its own
// window (0 before, 1 after). No nesting by time window, so an overshooting spring on one key composes
// with the next key exactly, and every term is the same piecewise polynomial hermite.ts emits. Tokens and
// energy are already resolved (tokens.ts).

import { isLegacyEasing, parseEasing, type EasingSpec } from './easing';
import { easedProgressExpr, fmt } from './hermite';

export interface TrackKey {
  t?: number | string;
  v: number | string;
  ease?: EasingSpec;
}

export interface TimedKey {
  at: number;
  v: number | string;
  ease?: EasingSpec;
}

const DEFAULT_SEGMENT = 0.6;

// The spring's own settle time, else the default segment length.
function naturalDuration(ease: EasingSpec | undefined): number {
  if (ease === undefined || isLegacyEasing(ease)) return DEFAULT_SEGMENT;

  return parseEasing(ease).settle ?? DEFAULT_SEGMENT;
}

/** Absolute key times: numbers are absolute, "+x" follows the previous key, omitted lets the ease decide. */
export function resolveKeyTimes(keys: readonly TrackKey[]): TimedKey[] {
  const timed: TimedKey[] = [];

  for (const [index, key] of keys.entries()) {
    const previous = index === 0 ? 0 : timed[index - 1].at;
    let at = previous + (index === 0 ? 0 : naturalDuration(key.ease));

    if (typeof key.t === 'number') at = key.t;

    if (typeof key.t === 'string') at = key.t.startsWith('+') ? previous + Number(key.t.slice(1)) : Number(key.t);

    timed.push({ at, v: key.v, ease: key.ease });
  }

  return timed;
}

/** Null when the keys are strictly increasing in time and every time is a finite number, else why not. */
export function keyTimesError(keys: readonly TrackKey[]): string | null {
  const timed = resolveKeyTimes(keys);

  for (const [index, key] of timed.entries()) {
    if (!Number.isFinite(key.at) || key.at < 0) return `key ${index} has an invalid time`;

    if (index > 0 && key.at <= timed[index - 1].at) {
      return `key ${index} (t=${fmt(key.at)}) is not after key ${index - 1}`;
    }
  }

  return null;
}

// A value as an expression: "+80" is relative to the resting `base`, a number is absolute.
function valueExpr(value: number | string, base: string | number): string {
  return typeof value === 'string' ? `(${base})${value}` : fmt(value);
}

function stepExpr(from: number | string, to: number | string, base: string | number): string | null {
  if (typeof from === typeof to) {
    const delta = (typeof to === 'string' ? Number(to) : to) - (typeof from === 'string' ? Number(from) : from);

    return delta === 0 ? null : fmt(delta);
  }

  return `(${valueExpr(to, base)}-(${valueExpr(from, base)}))`;
}

function easedStep(previous: TimedKey, key: TimedKey, time: string): string {
  const window = { delay: previous.at, duration: key.at - previous.at };
  const ease = key.ease ?? 'linear';

  // Linear stays a plain clamped ramp; every other curve gets the Hermite lowering.
  if (ease === 'linear') {
    const start = fmt(window.delay);

    return `if(lt(${time},${start}),0,if(lt(${time},${fmt(key.at)}),(${time}-${start})/${fmt(window.duration)},1))`;
  }

  return easedProgressExpr(parseEasing(ease), window, time);
}

/** The track's value over time as an (unquoted) expression in `time` (default drawtext's `t`). */
export function trackExpr(keys: readonly TrackKey[], base: string | number = 0, time = 't'): string {
  const timed = resolveKeyTimes(keys);
  const terms = [valueExpr(timed[0].v, base)];

  for (let index = 1; index < timed.length; index++) {
    const step = stepExpr(timed[index - 1].v, timed[index].v, base);

    if (step !== null) terms.push(`${step}*(${easedStep(timed[index - 1], timed[index], time)})`);
  }

  return terms.join('+');
}

export interface AnimateTracks {
  x?: TrackKey[];
  y?: TrackKey[];
  opacity?: TrackKey[];
  scale?: TrackKey[];
}

/**
 * Applies `animate` tracks onto drawtext values (mutating them): x/y from the resting base position,
 * alpha clamped to 0..1, fontsize as the base size times the scale track. A track overrides the same
 * property an entrance/exit baked.
 */
export function applyTracks(
  values: Record<string, unknown>,
  animate: AnimateTracks,
  base: { x: string | number; y: string | number }
): void {
  if (animate.x) values.x = `'${trackExpr(animate.x, base.x)}'`;

  if (animate.y) values.y = `'${trackExpr(animate.y, base.y)}'`;

  if (animate.opacity) values.alpha = `'clip(${trackExpr(animate.opacity)},0,1)'`;

  if (animate.scale && typeof values.fontsize === 'number') {
    values.fontsize = `'${fmt(values.fontsize)}*(${trackExpr(animate.scale)})'`;
  }
}
