// packages/ffmpeg-video-composer/src/core/brand/css.ts
// Colours from a site's own CSS, by pattern, without a CSS engine: declared colours (hex, rgb(), hsl(),
// black and white) weighted by where they appear, with the page's theme-color folded in (fonts: fonts.ts).
// Good enough to seed a theme; the theme step enforces contrast after.

import { declarations, stripComments } from './css-syntax';
import type { BrandColor } from './types';

export { cssFonts } from './fonts';

const WEIGHT = { brandProperty: 5, property: 2, background: 2, declaration: 1 } as const;
// A whole word of the property's name (`--color-brand-500`, `--colorPrimary`), not a fragment (`--themed-bg`).
const BRAND_NAME =
  /(?:^|[-_])(?:brand|primary|accent|main|theme)(?![a-z])|[a-z](?:Brand|Primary|Accent|Main|Theme)(?![a-z])/;
const KEYWORDS: Record<string, string> = { black: '#000000', white: '#ffffff' };

function hex2(value: number): string {
  return Math.round(Math.max(0, Math.min(255, value)))
    .toString(16)
    .padStart(2, '0');
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  function f(n: number): number {
    const k = (n + h / 30) % 12;

    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  }

  return `#${hex2(f(0))}${hex2(f(8))}${hex2(f(4))}`;
}

function alphaOf(parts: string[]): number {
  const raw = parts.at(3);

  if (raw === undefined) return 1;

  return raw.endsWith('%') ? Number.parseFloat(raw) / 100 : Number.parseFloat(raw);
}

function channel(part: string): number {
  const n = Number.parseFloat(part);

  return part.endsWith('%') ? n * 2.55 : n;
}

function hueDegrees(part: string): number {
  const n = Number.parseFloat(part);

  if (part.endsWith('grad')) return (n * 360) / 400;

  if (part.endsWith('rad')) return (n * 180) / Math.PI;

  if (part.endsWith('turn')) return n * 360;

  return n;
}

/** A hue in [0, 360): negative and full-turn hues wrap. */
function wrapHue(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

function hexColor(digits: string): string | null {
  const full = digits.length <= 4 ? digits.replace(/./g, (d) => d + d) : digits;

  if (full.length === 8 && Number.parseInt(full.slice(6), 16) / 255 < 0.5) return null;

  return `#${full.slice(0, 6)}`;
}

export function normalizeColor(value: string): string | null {
  const v = value.trim().toLowerCase();

  if (Object.hasOwn(KEYWORDS, v)) return KEYWORDS[v];

  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v);

  if (hex) return hexColor(hex[1]);

  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(v);

  if (!fn) return null;

  const parts = fn[2].split(/[\s,/]+/).filter(Boolean);

  if (parts.length < 3 || alphaOf(parts) < 0.5) return null;

  if (fn[1].startsWith('rgb')) {
    return `#${parts
      .slice(0, 3)
      .map((p) => hex2(channel(p)))
      .join('')}`;
  }

  return hslToHex(wrapHue(hueDegrees(parts[0])), Number.parseFloat(parts[1]) / 100, Number.parseFloat(parts[2]) / 100);
}

// Bounded, paren-free bodies keep every pattern linear on hostile input.
const COLOR_VALUE = /#[0-9a-f]{3,8}\b|rgba?\([^()]{0,100}\)|hsla?\([^()]{0,100}\)|\bblack\b|\bwhite\b/gi;

function colorsIn(value: string): string[] {
  return (value.match(COLOR_VALUE) ?? []).map(normalizeColor).filter((hex): hex is string => hex !== null);
}

const COLOR_PROPERTIES = new Set(['background', 'background-color', 'color', 'border-color', 'fill']);

export function cssColors(input: string): BrandColor[] {
  const css = stripComments(input);
  const found = new Map<string, BrandColor>();
  function add(hex: string, weight: number, source: BrandColor['source']): void {
    const current = found.get(hex);

    if (!current) {
      found.set(hex, { hex, weight, source });

      return;
    }

    current.weight += weight;

    if (source === 'custom-property') current.source = source;
  }

  for (const [property, value] of declarations(css)) {
    if (property.startsWith('--')) {
      const weight = BRAND_NAME.test(property) ? WEIGHT.brandProperty : WEIGHT.property;

      for (const hex of colorsIn(value)) add(hex, weight, 'custom-property');
      continue;
    }

    if (!COLOR_PROPERTIES.has(property)) continue;

    const weight = property.startsWith('background') ? WEIGHT.background : WEIGHT.declaration;

    for (const hex of colorsIn(value)) add(hex, weight, 'declaration');
  }

  return [...found.values()].sort((a, b) => b.weight - a.weight);
}

/** The declared theme-color's least weight, and its share of the CSS palette on a large one. */
const THEME_COLOR_WEIGHT = 6;
const THEME_COLOR_SHARE = 0.05;

/**
 * The CSS palette with the page's declared theme-color folded in: added to the weight the CSS already gives
 * that colour (never replacing it), and worth a share of the palette, so it still counts on a site whose CSS
 * names hundreds of colours.
 */
export function withThemeColor(colors: BrandColor[], themeHex: string | null): BrandColor[] {
  if (themeHex === null) return colors;

  const total = colors.reduce((sum, color) => sum + color.weight, 0);
  const weight = Math.max(THEME_COLOR_WEIGHT, Math.round(total * THEME_COLOR_SHARE));
  const current = colors.find((color) => color.hex === themeHex);
  const merged: BrandColor = { hex: themeHex, weight: weight + (current?.weight ?? 0), source: 'theme-color' };

  return [merged, ...colors.filter((color) => color !== current)].sort((a, b) => b.weight - a.weight);
}
