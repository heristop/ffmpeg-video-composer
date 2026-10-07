// Shared plumbing of the fx primitives that draw MARKS rather than light washes (ripple, glint,
// confetti): compile-time sprites moved, scaled, turned and faded per frame, laid over a REGION that may
// be larger than the target (a ring grows past the button it taps, confetti flies over the whole frame).
//
// - drawIn (fx-kit, re-exported here) widens the context's target to that region before the dispatcher
//   composites: the region is unmasked, snapped to even pixels and clamped to the frame, so nothing outside
//   it changes, bit for bit.
// - spriteStream turns one sprite input (a looped still, 25 fps by default) into N branches on the section
//   frame rate, trimmed to the effect window, so per-frame expressions (scale, rotate) step on every
//   output frame and nothing runs before the window opens.
// Filters: fps, trim, split, colorchannelmixer, fade, scale (eval=frame), rotate: all on-device.

import type { Filter, FilterGraphChain } from '@/core/types';
import { parseColor, rgbToHex } from '@/core/color-contrast';
import { fmt } from '@/core/motion/hermite';
import { resolveTheme } from '@/core/theme/resolve';
import type { ThemeSpec } from '@/core/theme/themes';
import type { AnyFxContext } from './fx-kit';
import type { SpriteSpec } from './fx-sprites';

/** Output frames per 1080 px of the frame's short side: sizes authored "at 1080p" scale by this. */
export function frameScale(fx: AnyFxContext): number {
  return Math.min(fx.frame.width, fx.frame.height) / 1080;
}

export function even(value: number): number {
  return 2 * Math.max(1, Math.round(value / 2));
}

/** A colour as the 6-hex sprite colour (no `#`), or null when it does not parse. */
export function spriteHex(color: string | undefined): string | null {
  const paint = color ? parseColor(color) : null;

  return paint ? rgbToHex(paint.rgb).slice(1).toLowerCase() : null;
}

/** The theme's colours in `names` order (hex only), from global.theme or the default theme. */
export function themeColors(fx: AnyFxContext, names: readonly string[]): string[] {
  const colors = resolveTheme(fx.theme as ThemeSpec | undefined)?.colors as Record<string, string> | undefined;

  return names.flatMap((name) => {
    const hex = spriteHex(colors?.[name]);

    return hex ? [hex] : [];
  });
}

export { drawIn, drawInFrame, type Region } from './fx-kit';

/**
 * One sprite as `count` branches on the section frame rate, trimmed to the effect window, with `filters`
 * (common to every branch: alpha, fades) applied once before the split. Null when the sprite cannot be
 * registered. Branch labels: `<prefix><key>_<i>`.
 */
export function spriteStream(
  fx: AnyFxContext,
  key: string,
  spec: SpriteSpec,
  count: number,
  filters: Filter[] = []
): { chains: FilterGraphChain[]; labels: string[] } | null {
  const input = fx.sprite(key, spec);

  if (!input || count < 1) return null;

  const labels = Array.from({ length: count }, (_, i) => `${fx.prefix}${key}_${i}`);
  const prep: Filter[] = [
    { type: 'format', value: 'rgba' },
    { type: 'fps', value: String(fx.frame.fps) },
    { type: 'trim', value: `start=${fmt(fx.at)}:end=${fmt(fx.end)}` },
    ...filters,
  ];
  const split: Filter[] = count > 1 ? [{ type: 'split', value: String(count) }] : [];

  return { chains: [{ inputs: [input], filters: [...prep, ...split], outputs: labels }], labels };
}

/** Uniform alpha scale of an RGBA branch (1 = unchanged: no filter). */
export function alphaScale(alpha: number): Filter[] {
  return alpha >= 0.999 ? [] : [{ type: 'colorchannelmixer', value: `aa=${fmt(Math.max(0, alpha))}` }];
}

/** Alpha fade in over `seconds` from `start` (at least one frame). */
export function fadeIn(fx: AnyFxContext, start: number, seconds: number): Filter {
  const d = Math.max(1 / fx.frame.fps, seconds);

  return { type: 'fade', value: `t=in:st=${fmt(start)}:d=${fmt(d)}:alpha=1` };
}

/** Alpha fade out over `seconds` from `start`; `power` 2 chains two fades: alpha ∝ (1 - p)², an ease-out. */
export function fadeOut(fx: AnyFxContext, start: number, seconds: number, power: 1 | 2 = 1): Filter[] {
  const d = Math.max(1 / fx.frame.fps, seconds);
  const fade: Filter = { type: 'fade', value: `t=out:st=${fmt(start)}:d=${fmt(d)}:alpha=1` };

  return power === 2 ? [fade, fade] : [fade];
}

/** The 4-frame minimum ramp of the doctrine, in seconds. */
export function rampOf(fx: AnyFxContext): number {
  return 4 / fx.frame.fps;
}

/** An even, ≥ 2 px size expression: `base` px times the per-frame `factor` expression. */
export function sizeExpr(base: number, factor: string): string {
  return `max(2,2*trunc(${fmt(base / 2)}*(${factor})+0.5))`;
}

/** Per-frame resize of a branch to `w` × `h` expressions (default: square, `h` = the output width). */
export function scaleTo(w: string, h = 'ow'): Filter {
  return { type: 'scale', value: `w='${w}':h='${h}':eval=frame` };
}

/** Overlay position expressions that centre the branch on (cx, cy) region px (expressions or numbers). */
export function centredAt(cx: string | number, cy: string | number): { x: string; y: string } {
  return { x: `${exprOf(cx)}-overlay_w/2`, y: `${exprOf(cy)}-overlay_h/2` };
}

function exprOf(value: string | number): string {
  return typeof value === 'number' ? fmt(value) : value;
}
