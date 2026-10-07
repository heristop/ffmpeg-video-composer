// fx "sheen": a specular light band crossing its target (schemas/fx-primitives.schemas.ts for the fields).
//
// The band is a `gradients` source sized to the band only (never the frame): 7 colour stops sample the
// light profile (bandProfile: a gaussian core plus a bloom twice as wide, a soft wash, or twin glints)
// along a tilted normal, so the stripes come out tilted without `rotate`; a light gblur turns the
// piecewise-linear stops into a smooth gaussian and a seeded dither on its alpha keeps 8-bit output free of
// banding. Its position along the travel axis follows the eased pass progress, from fully before the
// target to fully past it, so the first and last frames of the window show no light at all. fx-kit clips
// it to the target and composites it back. Without `gradients` (a host probe that lacks it) the same band
// is a compile-time sprite. Reduced motion: a still 8% highlight fading in and out.

import type { Filter } from '@/core/types';
import { fmt } from '@/core/motion/hermite';
import { bandProfile, type SpriteSpec } from './fx-sprites';
import {
  ditherFilters,
  gradientSeed,
  passProgress,
  shiftTo,
  sourceTiming,
  staticHighlight,
  type FxContext,
  type FxEffect,
  type FxLayer,
} from './fx-kit';

const STOPS = 7;
const REDUCED_ALPHA = 0.08;
/** gblur σ as a share of the spacing between stops: rounds the joints of the linear stops, keeps the profile. */
const SMOOTHING = 0.2;

export interface Band {
  /** Travel along x (right/left) or y (down/up). */
  horizontal: boolean;
  forward: boolean;
  /** Profile half-span in px (the light reaches ~0 at ±width). */
  width: number;
  /** Tilt off the perpendicular of the travel, radians. */
  tilt: number;
  /** Source size along the travel axis and across it (the target plus `margin` on each side). */
  along: number;
  across: number;
  /** Px the source overhangs the target on each side, so the blur never meets a source edge in view. */
  margin: number;
}

/** gblur σ for a band of half-span `width`: half the spacing between stops. */
function blurSigma(width: number): number {
  return Math.max(0.5, ((2 * width) / (STOPS - 1)) * SMOOTHING);
}

function even(value: number): number {
  return 2 * Math.ceil(value / 2);
}

// Context defaults, drawn in a fixed order from the element's seeded stream: tilt, then width jitter.
export function bandOf(fx: FxContext<'sheen'>): Band {
  const g = fx.graphic;
  const { w, h } = fx.target;
  const tiltDefault = 14 + Math.round(fx.random() * 24) / 2;
  const widthDefault = 0.15 * (0.85 + fx.random() * 0.3);
  const direction = g.direction ?? (h > w * 1.25 ? 'down' : 'right');
  const horizontal = direction === 'right' || direction === 'left';
  const width = Math.max(2, (g.width ?? widthDefault) * Math.min(w, h));
  const tilt = ((g.tilt ?? tiltDefault) * Math.PI) / 180;
  const cross = horizontal ? h : w;
  const margin = even(3 * blurSigma(width));
  const across = cross + 2 * margin;
  const along = even((2 * width) / Math.cos(tilt) + across * Math.abs(Math.tan(tilt)) + 2 * margin);

  const forward = direction === 'right' || direction === 'down';

  return { horizontal, forward, width, tilt, along, across, margin };
}

/** Stops from the centre outward (centre, two inner, the transparent end); `gradients` interpolates linearly. */
const HALF = (STOPS - 1) / 2;
const FIT_STEPS = { inner: [0.7, 1.1], outer: [0.3, 1.2], step: 0.02 } as const;
const FIT_SAMPLES = 12;

// The linear interpolation of half-band stops `v` (centre first) at `u` = offset / width (0..1).
function between(v: readonly number[], u: number): number {
  const at = Math.min(HALF, u * HALF);
  const i = Math.min(HALF - 1, Math.floor(at));

  return v[i] + (v[i + 1] - v[i]) * (at - i);
}

/** The gblur that follows the stops, in units of the band's half-width (σ = SMOOTHING × stop spacing). */
const BLUR_U = SMOOTHING / HALF;
const TAPS = [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2].map((t) => ({ t: t * BLUR_U, w: Math.exp(-(t * t) / 2) }));
const TAP_SUM = TAPS.reduce((sum, tap) => sum + tap.w, 0);

// The stops as rendered: interpolated, then blurred (symmetric about the centre).
function rendered(v: readonly number[], u: number): number {
  return TAPS.reduce((sum, tap) => sum + tap.w * between(v, Math.abs(u + tap.t)), 0) / TAP_SUM;
}

// Worst gap between the rendered band and the profile, both normalised to their own peak.
function worstError(v: readonly number[], target: readonly number[]): number {
  const shape = target.map((_, k) => rendered(v, k / FIT_SAMPLES));
  const peak = Math.max(...shape);
  const goal = Math.max(...target);

  return Math.max(...shape.map((value, k) => Math.abs(value / peak - target[k] / goal)));
}

function range([from, to]: readonly number[]): number[] {
  return Array.from({ length: Math.round((to - from) / FIT_STEPS.step) + 1 }, (_, i) => from + i * FIT_STEPS.step);
}

/**
 * The two inner stops each side, scaled so the band AS RENDERED (linear between stops, then the smoothing
 * blur) follows the profile between the stops too: sampled stops alone overshoot the gaussian's shoulder by
 * ~9 % of the peak. A coarse minimax search over scale factors: deterministic, ~10⁵ multiply-adds.
 */
function fitHalf(profile: (u: number) => number): number[] {
  const sampled = [0, 1, 2].map((i) => profile(i / HALF));
  const target = Array.from({ length: FIT_SAMPLES + 1 }, (_, k) => profile(k / FIT_SAMPLES));
  let best = { error: Infinity, v: [...sampled, 0] };

  for (const a of range(FIT_STEPS.inner)) {
    for (const b of range(FIT_STEPS.outer)) {
      const v = [sampled[0], sampled[1] * a, sampled[2] * b, 0];
      const error = worstError(v, target);

      if (error < best.error - 1e-9) best = { error, v };
    }
  }

  return best.v;
}

/** The band's 7 evenly spaced stops across ±width, fitted to the profile; the ends are exactly transparent. */
export function sheenStops(fx: FxContext<'sheen'>, width: number): number[] {
  const g = fx.graphic;
  const spec = { width, peak: fx.peak, bloom: g.bloom ?? 0.25, profile: g.profile ?? 'specular' };
  const half = fitHalf((u) => bandProfile(u * width, spec));

  return Array.from({ length: STOPS }, (_, i) => half[Math.abs(i - HALF)]);
}

function clampTo(value: number, size: number): number {
  return Math.min(size - 1, Math.max(0, Math.round(value)));
}

// gradients endpoints (image coordinates of the source) for the band's normal through the centre.
function endpoints(band: Band): string {
  const [na, nc] = [Math.cos(band.tilt), Math.sin(band.tilt)];
  const [w, h] = band.horizontal ? [band.along, band.across] : [band.across, band.along];
  const [nx, ny] = band.horizontal ? [na, nc] : [nc, na];
  const [dx, dy] = [nx * band.width, ny * band.width];

  return [
    `x0=${clampTo(w / 2 - dx, w)}:y0=${clampTo(h / 2 - dy, h)}`,
    `x1=${clampTo(w / 2 + dx, w)}:y1=${clampTo(h / 2 + dy, h)}`,
  ].join(':');
}

function sourceSize(band: Band): string {
  return band.horizontal ? `${band.along}x${band.across}` : `${band.across}x${band.along}`;
}

function gradientBand(fx: FxContext<'sheen'>, band: Band): Filter[] {
  const colors = sheenStops(fx, band.width)
    .map((alpha, i) => `c${i}=${fx.color}@${fmt(alpha)}`)
    .join(':');
  const value = `s=${sourceSize(band)}:${colors}:nb_colors=${STOPS}:${endpoints(band)}:speed=0.00001:${gradientSeed(fx)}:${sourceTiming(fx)}`;
  const [format, ...dither] = ditherFilters(fx);
  const sigma = blurSigma(band.width);

  return [
    { type: 'gradients', value },
    shiftTo(fx),
    format,
    { type: 'gblur', value: `sigma=${fmt(sigma)}` },
    ...dither,
  ];
}

// The same band as a compile-time sprite (looped still input), for builds without `gradients`.
function spriteBand(fx: FxContext<'sheen'>, band: Band): string | null {
  const g = fx.graphic;
  const [w, h] = band.horizontal ? [band.along, band.across] : [band.across, band.along];
  const degrees = (band.tilt * 180) / Math.PI;
  const spec: SpriteSpec = {
    kind: 'band',
    w,
    h,
    width: Math.round(band.width * 10) / 10,
    tilt: Math.round((band.horizontal ? degrees : 90 - degrees) * 10) / 10,
    bloom: g.bloom ?? 0.25,
    peak: Math.round(fx.peak * 1000) / 1000,
    profile: g.profile ?? 'specular',
    ...(/^#[0-9a-f]{6}$/i.test(fx.color) ? { color: fx.color.slice(1).toLowerCase() } : {}),
  };

  return fx.sprite('band', spec);
}

/** Band position along the travel axis (source's leading edge, target px): before → past the target. */
function travel(fx: FxContext<'sheen'>, band: Band): string {
  const span = (band.horizontal ? fx.target.w : fx.target.h) + band.along;
  const p = passProgress(fx);

  return band.forward ? `-${band.along}+${span}*(${p})` : `${span - band.along}-${span}*(${p})`;
}

function lower(fx: FxContext<'sheen'>): FxLayer[] | null {
  if (fx.reduced) return [staticHighlight(fx, Math.min(REDUCED_ALPHA, fx.peak))];

  const band = bandOf(fx);
  const label = `${fx.prefix}b`;
  const sprite = fx.has('gradients') ? null : spriteBand(fx, band);

  if (!fx.has('gradients') && !sprite) return null;

  const chains = sprite
    ? [{ inputs: [sprite], filters: ditherFilters(fx), outputs: [label] }]
    : [{ filters: gradientBand(fx, band), outputs: [label] }];
  const at = travel(fx, band);
  const cross = `-${band.margin}`;

  return [{ chains, label, x: band.horizontal ? at : cross, y: band.horizontal ? cross : at }];
}

export const SHEEN: FxEffect<'sheen'> = { lower };
