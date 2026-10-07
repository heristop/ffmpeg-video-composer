// Contrast-aware colour for the frame / corners strokes (`contrast: "auto"`). The background under a
// stroke is known only on a color_background section: its base colour and the solid layers drawn over it
// (a layer with a gradient or partial opacity over an unknown colour makes it unknown again). From it:
// an unset colour becomes light or dark ink by luminance, and a colour that reads poorly (WCAG contrast
// below MIN_CONTRAST) or any unknown background gets a soft offset shadow.

import type { Section } from '@/core/types';
import { resolveLayerGeometry } from '../utils/input-sources';
import type { SugarContext } from './sugar-context';

type Rgb = [number, number, number];

export const LIGHT_INK = '#F5F3F7';
export const DARK_INK = '#16181D';
/** Below this WCAG contrast ratio a stroke gets its shadow. */
export const MIN_CONTRAST = 2.5;

export function parseHex(color: string | undefined): Rgb | null {
  const hex = /^#?([0-9a-f]{6})(?:@.*)?$/i.exec(color ?? '')?.[1];

  return hex ? ([0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16)) as Rgb) : null;
}

/** WCAG relative luminance, 0 (black) .. 1 (white). */
export function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255;

    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

interface LayerLike {
  color?: string;
  opacity?: number;
  gradient?: unknown;
  x?: number | string;
  y?: number | string;
  w?: number | string;
  h?: number | string;
}

function mix(under: Rgb, over: Rgb, alpha: number): Rgb {
  return under.map((c, i) => c + (over[i] - c) * alpha) as Rgb;
}

function inside(layer: LayerLike, point: { x: number; y: number }, scale: string): boolean {
  const box = resolveLayerGeometry(layer, scale);

  return point.x >= box.x && point.x < box.x + box.w && point.y >= box.y && point.y < box.y + box.h;
}

function resolved(ctx: SugarContext, color: string | undefined): Rgb | null {
  return color ? parseHex(ctx.masks?.color(color) ?? color) : null;
}

// The colour under a layer after drawing it: unknown when the layer (or what it partly covers) is unknown.
function over(under: Rgb | null, layer: LayerLike, color: Rgb | null): Rgb | null {
  const opacity = layer.opacity ?? 1;

  if (!color) return null;

  if (opacity >= 1) return color;

  return under ? mix(under, color, opacity) : null;
}

/** The solid colour under `point`, or null when it is not known at compile time. */
export function backgroundAt(section: Section, ctx: SugarContext, point: { x: number; y: number }): Rgb | null {
  if (section.type !== 'color_background') return null;

  const options = (section.options ?? {}) as { backgroundColor?: string; layers?: LayerLike[] };
  let rgb = resolved(ctx, options.backgroundColor);

  for (const layer of options.layers ?? []) {
    if (inside(layer, point, ctx.scale)) rgb = over(rgb, layer, layer.gradient ? null : resolved(ctx, layer.color));
  }

  return rgb;
}

export interface StrokeInk {
  color: string;
  shadow: boolean;
}

/**
 * Ink for strokes over `backgrounds` (luminances, null = unknown). An authored colour is kept and only gets
 * a shadow when it reads poorly; an unset one becomes light or dark ink when every background is known
 * and on the same side, else light ink with a shadow.
 */
export function pickInk(authored: string | null, fallback: string, backgrounds: (number | null)[]): StrokeInk {
  const known = backgrounds.filter((value): value is number => value !== null);
  const unknown = known.length < backgrounds.length || known.length === 0;

  if (authored) {
    const rgb = parseHex(authored);
    const ink = rgb ? luminance(rgb) : null;
    const weak = ink === null || known.some((bg) => contrastRatio(ink, bg) < MIN_CONTRAST);

    return { color: authored, shadow: unknown || weak };
  }

  if (unknown) return { color: fallback, shadow: true };

  const light = known.every((bg) => bg > 0.4);
  const dark = known.every((bg) => bg <= 0.4);

  if (light) return { color: DARK_INK, shadow: false };

  return { color: fallback, shadow: !dark };
}
