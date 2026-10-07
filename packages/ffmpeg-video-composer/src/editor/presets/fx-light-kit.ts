// Helpers shared by the leak, edge-glow and ambient fx primitives (fx-leak.ts, fx-edge-glow.ts, fx-bloom.ts,
// fx-vignette.ts, fx-grain.ts): colour arithmetic on "#rrggbb" values, frame-relative sizes, eased alpha
// envelopes from `fade` filters, and a pass-through of the region for light built from the picture itself.
// Pure functions of the context: no seed is drawn here.

import type { Filter } from '@/core/types';
import { fmt } from '@/core/motion/hermite';
import type { AnyFxContext } from './fx-kit';

export type Rgb = [number, number, number];

/** "#rrggbb" (an @alpha suffix is ignored) → channels; null for anything else. */
export function rgbOf(color: string | undefined): Rgb | null {
  const hex = /^#?([0-9a-f]{6})(@.*)?$/i.exec(color ?? '')?.[1];

  return hex ? ([0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16)) as Rgb) : null;
}

export function hexOf(rgb: readonly number[]): string {
  const bytes = rgb.map((value) => Math.min(255, Math.max(0, Math.round(value))));

  return `#${bytes.map((value) => value.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/** `a` moved toward `b` by `t` (0..1), per channel. */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return a.map((value, i) => value + (b[i] - value) * t) as Rgb;
}

/**
 * The colour's hue pushed further from white by `gain` (its brightest channel kept), so a lightly tinted
 * light becomes a clearly tinted one: the default light colour leans 12 % toward the theme accent, and a
 * gain of 4 makes that lean read as the brand's tint.
 */
export function saturate(color: Rgb, gain: number): Rgb {
  const top = Math.max(...color);

  return color.map((value) => Math.max(0, top - (top - value) * gain)) as Rgb;
}

/** An authored "#rrggbb" or the fallback, as hex without alpha. */
export function colorOr(authored: string | undefined, fallback: Rgb): string {
  return hexOf(rgbOf(authored) ?? fallback);
}

/** px at a 1080-px short side, scaled to this output frame. */
export function atFrame(fx: AnyFxContext, px1080: number): number {
  return (px1080 * Math.min(fx.frame.width, fx.frame.height)) / 1080;
}

export function even(value: number): number {
  return Math.max(2, 2 * Math.round(value / 2));
}

function ramp(kind: 'in' | 'out', start: number, length: number): Filter {
  return { type: 'fade', value: `t=${kind}:st=${fmt(start)}:d=${fmt(length)}:alpha=1` };
}

/**
 * An eased alpha envelope over the effect's life, from `fade` filters (alpha=1): two ramps in, so the
 * light starts at zero slope, and two ramps out, so it leaves with a long, soft tail. `rise` and `fall`
 * are shares of the life; each ramp lasts at least 4 frames (no hard frame).
 */
export function envelope(fx: AnyFxContext, rise: number, fall: number): Filter[] {
  const life = fx.end - fx.at;
  const floor = 4 / fx.frame.fps;
  const up = Math.max(floor, life * rise);
  const down = Math.max(floor, Math.min(life - up, life * fall));

  return [
    ramp('in', fx.at, up),
    ramp('in', fx.at, up * 0.6),
    ramp('out', fx.end - down, down),
    ramp('out', fx.end - down * 0.6, down * 0.6),
  ];
}

/** A constant-alpha envelope with linear ramps of `seconds` at both ends (ambient textures). */
export function ambientRamps(fx: AnyFxContext, seconds: number): Filter[] {
  const life = fx.end - fx.at;
  const length = Math.max(4 / fx.frame.fps, Math.min(seconds, life / 2));

  return [ramp('in', fx.at, length), ramp('out', fx.end - length, length)];
}

/**
 * A still layer computed ONCE: keep the source's first frame and move it to the window start. Pair with
 * `holdFor` after the per-pixel work (blur, scale, dither), so it runs on one frame instead of every frame.
 */
export function firstFrame(fx: AnyFxContext): Filter[] {
  return [
    { type: 'trim', value: 'end_frame=1' },
    { type: 'setpts', value: `PTS-STARTPTS+${fmt(fx.at)}/TB` },
  ];
}

/** Repeats that one frame for the whole window (bounded: an endless loop would never let the graph end). */
export function holdFor(fx: AnyFxContext): Filter {
  const frames = Math.max(1, Math.round((fx.end - fx.at) * fx.frame.fps));

  return { type: 'loop', value: `loop=${frames}:size=1:start=0` };
}

/**
 * Alpha dither of the soft lights: ±PEDESTAL steps of uniform noise, softened by an alpha-only blur of
 * SIGMA px into a fine grain of about ±1 composited code value. Weaker dither (±1 alpha step) is smoothed
 * away by every H.264 preset at crf 23, which then draws the light's slow falloff as clean
 * 1-code-value contours; this grain survives the encode and breaks them.
 */
const DITHER = { pedestal: 8, sigma: 0.7 };

/**
 * Static dither for wide, soft light layers (already in an alpha format). Lit pixels are lifted by a
 * pedestal, noised by ±pedestal, the alpha plane alone is blurred into a fine grain, and the pedestal is
 * taken back off: lit pixels keep their mean alpha (a tail of 1 stays a sparse spray, so the light's
 * reach is unchanged) and empty pixels stay exactly empty (beyond the blur's 2-px reach of a lit pixel).
 * ±3 on the light's own luma breaks the contours a subtle lift over a light picture would draw. Without
 * gblur (it is on the device allowlist, but a build might lack it) the dither is the plain ±1 alpha step.
 * Light layers stay well below opaque, so the pedestal never clips at 255.
 */
export function softDither(fx: AnyFxContext): Filter[] {
  const seed = fx.seed % 2147483647;
  const { pedestal: k, sigma } = DITHER;

  if (!fx.has('gblur')) {
    return [
      { type: 'noise', value: `c0s=7:c0f=u:c3s=3:c3f=u:all_seed=${seed}` },
      { type: 'lutyuv', value: "a='if(lt(val,2),0,val)'" },
    ];
  }

  return [
    { type: 'lutyuv', value: `a='if(gt(val,0),val+${k},0)'` },
    { type: 'noise', value: `c0s=7:c0f=u:c3s=${2 * k + 1}:c3f=u:all_seed=${seed}` },
    { type: 'gblur', value: `sigma=${sigma}:planes=8` },
    { type: 'lutyuv', value: `a='max(val-${k},0)'` },
  ];
}

/** Starts a tap (region copy, section time from 0) at the window: nothing upstream runs before `at`. */
export function fromWindow(fx: AnyFxContext): Filter {
  return { type: 'trim', value: `start=${fmt(fx.at)}` };
}

/** A constant alpha of `alpha` (0..1) on a layer that has none yet (converts to yuva420p). */
export function withAlpha(alpha: number, format = 'yuva420p'): Filter[] {
  return [
    { type: 'format', value: format },
    { type: 'lutyuv', value: `a=${Math.round(255 * Math.min(1, Math.max(0, alpha)))}` },
  ];
}
