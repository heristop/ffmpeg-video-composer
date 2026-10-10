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

/** Samples per pixel side when measuring how much of a corner pixel the arc covers. */
const COVERAGE_SAMPLES = 8;
/** Edge-pixel opacity is quantised to this many levels, so neighbouring pixels can share a box. */
const COVERAGE_LEVELS = 8;

// How much of pixel (col, row) of a top-left corner of radius r (circle centre at (r, r)) lies inside the
// arc, in COVERAGE_LEVELS steps: 0 outside, COVERAGE_LEVELS fully inside.
function pixelCoverage(radius: number, col: number, row: number): number {
  const n = COVERAGE_SAMPLES;
  let inside = 0;

  for (let k = 0; k < n * n; k++) {
    const dx = radius - col - ((k % n) + 0.5) / n;
    const dy = radius - row - (Math.floor(k / n) + 0.5) / n;

    if (dx * dx + dy * dy <= radius * radius) inside++;
  }

  return Math.round((inside / (n * n)) * COVERAGE_LEVELS);
}

interface CornerRun {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Coverage in COVERAGE_LEVELS steps; COVERAGE_LEVELS is a solid strip reaching the plate's middle. */
  level: number;
}

// A top-left corner of radius r as runs in corner coordinates. Per pixel row: the partly covered pixels,
// each at its coverage (neighbours at the same level share a run), then a solid strip from the first fully
// covered pixel to the corner's inner edge. A run identical to the one right above it extends that one.
function cornerRuns(radius: number): CornerRun[] {
  const runs: CornerRun[] = [];

  for (let y = 0; y < radius; y++) {
    const row: CornerRun[] = [];

    for (let x = 0; x < radius; x++) {
      const level = pixelCoverage(radius, x, y);
      const last = row.at(-1);

      if (level === COVERAGE_LEVELS) {
        row.push({ x, y, w: radius - x, h: 1, level });
        break;
      }

      if (last?.level === level && last.x + last.w === x) {
        last.w++;
        continue;
      }

      if (level > 0) row.push({ x, y, w: 1, h: 1, level });
    }

    for (const run of row) {
      const above = runs.find((m) => m.x === run.x && m.w === run.w && m.level === run.level && m.y + m.h === y);

      if (above) {
        above.h++;
        continue;
      }

      runs.push(run);
    }
  }

  return runs;
}

// `#rrggbb@a` at `level` of its opacity.
function colorAtLevel(color: string, level: number): string {
  const [hex, alpha = '1'] = color.split('@');

  return level === COVERAGE_LEVELS ? color : `${hex}@${fmt((Number(alpha) * level) / COVERAGE_LEVELS)}`;
}

/**
 * A plate behind one line: a filled rectangle with anti-aliased rounded corners. Each corner pixel the
 * arc crosses is drawn at the share of it the arc covers; whole-pixel edges and runs that never overlap
 * keep a translucent plate free of seams.
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
  // A solid run reaching the corner's inner edge spans the plate to the mirrored edge in one box.
  const strips = cornerRuns(radius).flatMap(({ x, y, w, h, level }) => {
    const paint = colorAtLevel(color, level);
    const solid = level === COVERAGE_LEVELS;
    const width = solid ? right - left - 2 * x : w;
    const mirrored = solid ? [] : [{ x: right - x - w, w }];
    const xs = [{ x: left + x, w: width }, ...mirrored];

    return xs.flatMap((span) => [
      rect({ x: span.x, y: top + y, w: span.w, h }, paint, enable),
      rect({ x: span.x, y: bottom - y - h, w: span.w, h }, paint, enable),
    ]);
  });
  const body = rect({ x: left, y: top + radius, w: right - left, h: bottom - top - 2 * radius }, color, enable);

  return [body, ...strips];
}
