// packages/ffmpeg-video-composer/src/core/brand/css.ts
// Colours and fonts from a site's own CSS, by pattern, without a CSS engine: declared colours (hex, rgb(),
// hsl(), black and white) weighted by where they appear, and the first-choice font family of the body,
// heading and code rules, followed through var() font tokens. Good enough to seed a theme; the theme step
// enforces contrast after.

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

  return hslToHex(hueDegrees(parts[0]), Number.parseFloat(parts[1]) / 100, Number.parseFloat(parts[2]) / 100);
}

// Bounded, paren-free bodies keep every pattern linear on hostile input.
const COLOR_VALUE = /#[0-9a-f]{3,8}\b|rgba?\([^()]{0,100}\)|hsla?\([^()]{0,100}\)|\bblack\b|\bwhite\b/gi;

function colorsIn(value: string): string[] {
  return (value.match(COLOR_VALUE) ?? []).map(normalizeColor).filter((hex): hex is string => hex !== null);
}

/** Drops `/* ... *\/` comments in one pass; an unterminated comment drops the rest. */
function stripComments(css: string): string {
  const out: string[] = [];
  let from = 0;

  for (;;) {
    const open = css.indexOf('/*', from);

    if (open === -1) {
      out.push(css.slice(from));

      return out.join('');
    }

    out.push(css.slice(from, open));

    const close = css.indexOf('*/', open + 2);

    if (close === -1) return out.join('');

    from = close + 2;
  }
}

function stripImportant(value: string): string {
  const bang = value.lastIndexOf('!');

  if (bang === -1 || !/^!\s*important\s*$/i.test(value.slice(bang))) return value;

  return value.slice(0, bang);
}

/** `prop: value` pairs from a block's text, split on `;`. */
function declarations(text: string): [string, string][] {
  const found: [string, string][] = [];
  let start = 0;

  for (let i = 0; i <= text.length; i++) {
    const code = text.codePointAt(i);

    // ; { }
    if (i < text.length && code !== 59 && code !== 123 && code !== 125) continue;

    if (i > start) {
      const piece = text.slice(start, i);
      const colon = piece.indexOf(':');

      if (colon !== -1) {
        found.push([piece.slice(0, colon).trim().toLowerCase(), stripImportant(piece.slice(colon + 1).trim())]);
      }
    }

    start = i + 1;
  }

  return found;
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

/** A family that is the site's own face: not a generic, a keyword, a metric fallback face or a size. */
function firstFamily(value: string): string | null {
  const first =
    value
      .split(',')[0]
      ?.trim()
      .replace(/^["']|["']$/g, '') ?? '';

  if (first === '' || first.startsWith('var(') || GENERIC_FAMILIES.has(first.toLowerCase())) return null;

  if (/fallback/i.test(first) || /^[\d.+-]/.test(first)) return null;

  return first;
}

/** Real font stacks are a few hundred characters; a longer value is cut before any var() is followed. */
const MAX_FAMILY_VALUE = 1000;
const MAX_VAR_DEPTH = 8;
/** Definitions of one custom property tried in order (a reset stack, a theme override, the site's face). */
const MAX_DEFINITIONS = 8;

interface VarCall {
  name: string;
  fallback: string | null;
  rest: string;
}

/** `var(--name[, fallback])` at the start of `value`, and what follows it; one pass with a depth counter. */
function varCall(value: string): VarCall {
  let depth = 1;
  let comma = -1;

  for (let i = 4; i < value.length; i++) {
    const ch = value[i];

    if (ch === '(') depth++;

    if (ch === ',' && depth === 1 && comma === -1) comma = i;

    if (ch === ')') depth--;

    if (depth === 0) {
      return {
        name: value.slice(4, comma === -1 ? i : comma).trim(),
        fallback: comma === -1 ? null : value.slice(comma + 1, i),
        rest: value.slice(i + 1).replace(/^[\s,]+/, ''),
      };
    }
  }

  return { name: value.slice(4, comma === -1 ? value.length : comma).trim(), fallback: null, rest: '' };
}

/**
 * Resolves `font-family` values through the site's custom properties (`var(--font-sans, …)` chains, their
 * fallbacks and what follows them). Each property resolves once, so a cycle or a long chain stays bounded.
 */
function familyResolver(properties: Map<string, string[]>): (value: string) => string | null {
  const resolved = new Map<string, string | null>();

  function ofProperty(name: string, depth: number): string | null {
    if (resolved.has(name)) return resolved.get(name) ?? null;

    resolved.set(name, null);

    const values = depth >= MAX_VAR_DEPTH ? [] : (properties.get(name) ?? []);
    let family: string | null = null;

    for (const value of values) {
      family ??= of(value, depth + 1);
    }

    resolved.set(name, family);

    return family;
  }

  function of(value: string, depth: number): string | null {
    const v = value.slice(0, MAX_FAMILY_VALUE).trim();

    if (!v.startsWith('var(')) return firstFamily(v);

    const call = varCall(v);
    const named = ofProperty(call.name, depth);

    if (named !== null) return named;

    const fallback = call.fallback === null ? null : of(call.fallback, depth + 1);

    if (fallback !== null || call.rest === '') return fallback;

    return of(call.rest, depth + 1);
  }

  return (value) => of(value, 0);
}

/** Font tokens by role, by their custom property's name (`--font-display`, `--ds-bodyMono-font-stack`). */
const FONT_TOKEN = /font|family|typeface/i;
const NOT_A_FAMILY_TOKEN = /size|weight|line|letter|spacing|height|leading|tracking|feature|variation|style|stretch/i;
const ROLE_TOKENS = {
  mono: /mono|code/i,
  display: /display|heading|headline|title/i,
  body: /body|text|sans|base|primary|default|copy/i,
} as const;

function roleOfToken(name: string): 'display' | 'body' | 'mono' | null {
  if (!FONT_TOKEN.test(name) || NOT_A_FAMILY_TOKEN.test(name)) return null;

  return (['mono', 'display', 'body'] as const).find((role) => ROLE_TOKENS[role].test(name)) ?? null;
}

const ROLE_SELECTORS = {
  display: /(^|[\s,>+~])(h1|h2|h3)\b|\.(title|display|heading|headline)\b|\.font-(display|heading|headline|title)\b/i,
  body: /(^|[\s,])(html|body|:root)\b|\.font-(sans|body|text)\b/i,
  mono: /(^|[\s,])(code|pre|kbd|samp)\b|\.mono\b|\.font-(mono|code)\b/i,
} as const;

/** `selector { body }` rules in one pass; at-rule preludes like `@media` are replaced by the inner selector. */
function rules(css: string): { selector: string; body: string }[] {
  const found: { selector: string; body: string }[] = [];
  let start = 0;
  let selector: string | null = null;

  for (let i = 0; i < css.length; i++) {
    const ch = css.codePointAt(i);

    // { }
    if (ch !== 123 && ch !== 125) continue;

    if (ch === 123) {
      selector = css.slice(start, i);
      start = i + 1;
    }

    if (ch === 125) {
      if (selector !== null) found.push({ selector, body: css.slice(start, i) });

      selector = null;
      start = i + 1;
    }
  }

  return found;
}

/** Every custom property's definitions, in order (a few per name). */
function customProperties(css: string): Map<string, string[]> {
  const properties = new Map<string, string[]>();

  for (const [property, value] of declarations(css)) {
    if (!property.startsWith('--')) continue;

    const values = properties.get(property) ?? [];

    if (values.length < MAX_DEFINITIONS) values.push(value);
    properties.set(property, values);
  }

  return properties;
}

function addFamily(fonts: BrandFonts, family: string): void {
  if (!fonts.families.includes(family)) fonts.families.push(family);
}

/** Roles from the rules that set a family: headings, body, code and their utility classes. */
function rolesFromRules(css: string, familyOf: (value: string) => string | null, fonts: BrandFonts): void {
  for (const { selector, body } of rules(css)) {
    const declared = declarations(body).find(([property]) => property === 'font-family');
    const family = declared ? familyOf(declared[1]) : null;

    if (family === null) continue;

    addFamily(fonts, family);

    for (const role of ['display', 'body', 'mono'] as const) {
      if (fonts[role] === null && ROLE_SELECTORS[role].test(selector)) fonts[role] = family;
    }
  }
}

/** Roles no rule named: the site's font tokens, by name, once resolved to a family. */
function rolesFromTokens(names: Iterable<string>, familyOf: (value: string) => string | null, fonts: BrandFonts) {
  for (const name of names) {
    const role = roleOfToken(name);
    const family = role === null || fonts[role] !== null ? null : familyOf(`var(${name})`);

    if (role === null || family === null) continue;

    fonts[role] = family;
    addFamily(fonts, family);
  }
}

export function cssFonts(input: string): BrandFonts {
  const css = stripComments(input);
  const fonts: BrandFonts = { display: null, body: null, mono: null, families: [] };
  const properties = customProperties(css);
  const familyOf = familyResolver(properties);

  rolesFromRules(css, familyOf, fonts);
  rolesFromTokens(properties.keys(), familyOf, fonts);

  return fonts;
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
