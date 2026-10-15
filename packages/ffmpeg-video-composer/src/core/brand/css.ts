// packages/ffmpeg-video-composer/src/core/brand/css.ts
// Colours and fonts from a site's own CSS, by pattern, without a CSS engine: declared colours (hex, rgb(),
// hsl(), black and white) weighted by where they appear, and the first-choice font family of the body,
// heading and code rules. Good enough to seed a theme; the theme step enforces contrast after.

import type { BrandColor, BrandFonts } from './types';

const WEIGHT = { brandProperty: 5, property: 2, background: 2, declaration: 1 } as const;
const BRAND_NAME = /brand|primary|accent|main|theme/i;
const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  'ui-rounded',
  'inherit',
  'initial',
  'unset',
  '-apple-system',
  'blinkmacsystemfont',
]);
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

export function normalizeColor(value: string): string | null {
  const v = value.trim().toLowerCase();

  if (Object.hasOwn(KEYWORDS, v)) return KEYWORDS[v];

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);

  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].replace(/./g, (d) => d + d) : hex[1];

    return `#${digits}`;
  }

  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(v);

  if (!fn) return null;

  const parts = fn[2].split(/[\s,/]+/).filter(Boolean);

  if (parts.length < 3 || alphaOf(parts) < 0.5) return null;

  if (fn[1].startsWith('rgb')) {
    return `#${parts
      .slice(0, 3)
      .map((p) => hex2(Number.parseFloat(p)))
      .join('')}`;
  }

  return hslToHex(Number.parseFloat(parts[0]), Number.parseFloat(parts[1]) / 100, Number.parseFloat(parts[2]) / 100);
}

const COLOR_VALUE = /#[0-9a-f]{3,6}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\bblack\b|\bwhite\b/gi;

function colorsIn(value: string): string[] {
  return (value.match(COLOR_VALUE) ?? []).map(normalizeColor).filter((hex): hex is string => hex !== null);
}

export function cssColors(css: string): BrandColor[] {
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

  for (const [, name, value] of css.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) {
    const weight = BRAND_NAME.test(name) ? WEIGHT.brandProperty : WEIGHT.property;

    for (const hex of colorsIn(value)) add(hex, weight, 'custom-property');
  }

  for (const [, property, value] of css.matchAll(
    /(?:^|[;{\s])(background(?:-color)?|color|border-color|fill)\s*:\s*([^;}]+)/g
  )) {
    const weight = property.startsWith('background') ? WEIGHT.background : WEIGHT.declaration;

    for (const hex of colorsIn(value)) add(hex, weight, 'declaration');
  }

  return [...found.values()].sort((a, b) => b.weight - a.weight);
}

function firstFamily(value: string): string | null {
  const first =
    value
      .split(',')[0]
      ?.trim()
      .replace(/^["']|["']$/g, '') ?? '';

  if (first === '' || first.startsWith('var(') || GENERIC_FAMILIES.has(first.toLowerCase())) return null;

  return first;
}

const ROLE_SELECTORS = {
  display: /(^|[\s,>+~])(h1|h2|h3)\b|\.(title|display|heading|headline)\b/i,
  body: /(^|[\s,])(html|body|:root)\b/i,
  mono: /(^|[\s,])(code|pre|kbd|samp)\b|\.mono\b/i,
} as const;

export function cssFonts(css: string): BrandFonts {
  const fonts: BrandFonts = { display: null, body: null, mono: null, families: [] };

  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declared = /font-family\s*:\s*([^;}]+)/i.exec(body);
    const family = declared ? firstFamily(declared[1]) : null;

    if (family === null) continue;

    if (!fonts.families.includes(family)) fonts.families.push(family);

    for (const role of ['display', 'body', 'mono'] as const) {
      if (fonts[role] === null && ROLE_SELECTORS[role].test(selector)) fonts[role] = family;
    }
  }

  return fonts;
}
