// Drawing primitives for subtitles: the colour a DNA token paints, the time window a filter is enabled
// in, the cue's entrance (a reveal preset), a positioned drawtext and the rounded plate behind a
// line. Every number goes through `fmt`, so the same plan always writes the same bytes.

import type { Filter } from '@/core/types';
import { fmt } from '@/core/motion/hermite';
import { parseThemeRef, resolveTheme, resolveThemeRef } from '@/core/theme/resolve';
import { DEFAULT_THEME, type ResolvedTheme, type ThemeSpec } from '@/core/theme/themes';
import type { CaptionDna, CaptionDnaEffect } from '@/core/captions/dna';
import type { PlacedLine } from '@/core/captions/plan';
import { applyTextEffect, revealToExpr } from './text';

const FALLBACK_COLOR = '#FFFFFF';
/** Vertical plate padding relative to the horizontal one. */
const PLATE_VERTICAL = 0.55;

export type Paint = (value: string) => string;

/** Resolves `$color.*` tokens (with `@alpha`) against the template theme; literals pass through. */
export function painter(spec: unknown): Paint {
  const theme: ResolvedTheme | undefined = resolveTheme(spec as ThemeSpec | undefined) ?? resolveTheme(DEFAULT_THEME);

  return (value) => {
    const ref = parseThemeRef(value);

    if (!ref) return value;

    return (theme && resolveThemeRef(ref, theme, 'fontcolor')) ?? FALLBACK_COLOR;
  };
}

/** `'gte(t,a)*lt(t,b)'`, optionally minus an inner window (the active word drawn on top instead). */
export function windowExpr(from: number, to: number, hole?: { from: number; to: number }): string {
  const base = `gte(t,${fmt(from)})*lt(t,${fmt(to)})`;

  return hole ? `'${base}*(1-gte(t,${fmt(hole.from)})*lt(t,${fmt(hole.to)}))'` : `'${base}'`;
}

export interface TextDraw {
  text: string;
  font: string;
  size: number | string;
  color: string;
  x: string;
  y: string;
  enable: string;
}

export interface CueLook {
  dna: CaptionDna;
  effect: CaptionDnaEffect | undefined;
  /** The cue's appearance time, the entrance delay. */
  start: number;
}

/** The DNA's legibility effect with its colours resolved. */
export function paintedEffect(effect: CaptionDnaEffect | undefined, paint: Paint): CaptionDnaEffect | undefined {
  if (!effect) return undefined;

  return {
    ...(effect.shadow && { shadow: { ...effect.shadow, color: paint(effect.shadow.color) } }),
    ...(effect.outline && { outline: { ...effect.outline, color: paint(effect.outline.color) } }),
  };
}

/** The y expression of text sitting on `baseline` (shared through max_glyph_a). */
export function baselineY(baseline: number): string {
  return `${fmt(baseline)}-max_glyph_a`;
}

/** One drawtext, with the cue's entrance (fade / rise) and the DNA's legibility effect. */
export function textFilter(draw: TextDraw, look: CueLook): Filter {
  const { entrance } = look.dna;
  const values: Record<string, unknown> = {
    text: draw.text,
    fontfile: draw.font,
    fontsize: draw.size,
    fontcolor: draw.color,
    x: draw.x,
    y: `'${draw.y}'`,
    enable: draw.enable,
  };
  const reveal = revealToExpr(
    {
      type: entrance.type,
      delay: look.start,
      duration: entrance.duration,
      distance: entrance.distance,
      easing: entrance.easing,
    },
    { x: draw.x, y: draw.y }
  );

  if (reveal.alpha) values.alpha = reveal.alpha;

  if (reveal.y) values.y = reveal.y;

  applyTextEffect(values, look.effect);

  return { type: 'drawtext', values };
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rect({ x, y, w, h }: Rect, color: string, enable: string): Filter {
  return { type: 'drawbox', values: { x: fmt(x), y: fmt(y), w: fmt(w), h: fmt(h), color, t: 'fill', enable } };
}

// Horizontal inset of the corner's pixel row `row` (0 = outermost) for a quarter circle of radius r.
function cornerInset(radius: number, row: number): number {
  const mid = radius - row - 0.5;

  return Math.round(radius - Math.sqrt(radius * radius - mid * mid));
}

// The corner's pixel rows as strips: consecutive rows with the same inset share one strip.
function cornerStrips(radius: number): Array<{ from: number; height: number; inset: number }> {
  const insets = Array.from({ length: radius }, (_, row) => cornerInset(radius, row));

  return insets.reduce<Array<{ from: number; height: number; inset: number }>>((strips, inset, row) => {
    const last = strips.at(-1);

    if (last?.inset === inset) {
      last.height += 1;

      return strips;
    }

    return [...strips, { from: row, height: 1, inset }];
  }, []);
}

/**
 * A plate behind one line: a filled rectangle whose corners follow the arc pixel row by pixel row (rows
 * with the same inset share a strip). Edges are whole pixels and the strips never overlap, so a
 * translucent plate has no seams.
 */
export function plateFilters(
  line: PlacedLine,
  size: number,
  box: NonNullable<CaptionDna['box']>,
  color: string,
  enable: string
): Filter[] {
  const padX = box.padding * size;
  const padY = padX * PLATE_VERTICAL;
  const left = Math.round(line.x - padX);
  const right = Math.round(line.x + line.width + padX);
  const top = Math.round(line.top - padY);
  const bottom = Math.round(line.top + size + padY);
  const radius = Math.floor(Math.min(box.radius * size, (bottom - top) / 2, (right - left) / 2));
  const strips = cornerStrips(radius).flatMap(({ from, height, inset }) => {
    const w = right - left - 2 * inset;

    return [
      rect({ x: left + inset, y: top + from, w, h: height }, color, enable),
      rect({ x: left + inset, y: bottom - from - height, w, h: height }, color, enable),
    ];
  });
  const body = rect({ x: left, y: top + radius, w: right - left, h: bottom - top - 2 * radius }, color, enable);

  return [body, ...strips];
}
