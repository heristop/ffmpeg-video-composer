// packages/ffmpeg-video-composer/src/core/brand/fonts.ts
// A site's display, body and code families from its CSS: the first-choice family of the heading, body and
// code rules (and their utility classes), followed through var() font tokens, else the tokens named for
// each role. Generic, system and metric-fallback faces are never a brand's family.

import { declarations, rules, stripComments } from './css-syntax';
import type { BrandFonts } from './types';

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

/** Real family names are a few words; a longer one is not a face the site ships. */
const MAX_FAMILY_NAME = 80;
/** Distinct families kept in a kit; the roles still read every rule. */
const MAX_FAMILIES = 64;

/** A family that is the site's own face: not a generic, a keyword, a metric fallback, an emoji face or a size. */
function firstFamily(value: string): string | null {
  const first =
    value
      .split(',')[0]
      ?.trim()
      .replace(/^["']|["']$/g, '') ?? '';

  if (first === '' || first.length > MAX_FAMILY_NAME) return null;

  if (first.startsWith('var(') || GENERIC_FAMILIES.has(first.toLowerCase())) return null;

  if (/fallback|emoji|symbol/i.test(first) || /^[\d.+-]/.test(first)) return null;

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
  // A result cut short by the depth limit holds only for starts at least that deep: a shallower start retries,
  // so each property resolves at most once per depth.
  const resolved = new Map<string, { family: string | null; depth: number; complete: boolean }>();
  const resolving = new Set<string>();
  let cuts = 0;

  function ofProperty(name: string, depth: number): string | null {
    const known = resolved.get(name);

    if (resolving.has(name)) return null;

    if (known && (known.complete || depth >= known.depth)) {
      if (!known.complete) cuts++;

      return known.family;
    }

    if (depth >= MAX_VAR_DEPTH) {
      cuts++;

      return null;
    }

    const before = cuts;
    let family: string | null = null;

    resolving.add(name);

    for (const value of properties.get(name) ?? []) {
      family ??= of(value, depth + 1);
    }

    resolving.delete(name);
    resolved.set(name, { family, depth, complete: family !== null || cuts === before });

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

/** Adds a family once, in order of appearance, up to MAX_FAMILIES; `seen` keeps the check constant-time. */
function addFamily(fonts: BrandFonts, seen: Set<string>, family: string): void {
  if (seen.has(family) || seen.size >= MAX_FAMILIES) return;

  seen.add(family);
  fonts.families.push(family);
}

/** Roles from the rules that set a family: headings, body, code and their utility classes. */
function rolesFromRules(
  css: string,
  familyOf: (value: string) => string | null,
  fonts: BrandFonts,
  seen: Set<string>
): void {
  for (const { selector, body } of rules(css)) {
    const declared = declarations(body).find(([property]) => property === 'font-family');
    const family = declared ? familyOf(declared[1]) : null;

    if (family === null) continue;

    addFamily(fonts, seen, family);

    for (const role of ['display', 'body', 'mono'] as const) {
      if (fonts[role] === null && ROLE_SELECTORS[role].test(selector)) fonts[role] = family;
    }
  }
}

/** Roles no rule named: the site's font tokens, by name, once resolved to a family. */
function rolesFromTokens(
  names: Iterable<string>,
  familyOf: (value: string) => string | null,
  fonts: BrandFonts,
  seen: Set<string>
) {
  for (const name of names) {
    const role = roleOfToken(name);
    const family = role === null || fonts[role] !== null ? null : familyOf(`var(${name})`);

    if (role === null || family === null) continue;

    fonts[role] = family;
    addFamily(fonts, seen, family);
  }
}

export function cssFonts(input: string): BrandFonts {
  const css = stripComments(input);
  const fonts: BrandFonts = { display: null, body: null, mono: null, families: [] };
  const properties = customProperties(css);
  const familyOf = familyResolver(properties);

  const seen = new Set<string>();

  rolesFromRules(css, familyOf, fonts, seen);
  rolesFromTokens(properties.keys(), familyOf, fonts, seen);

  return fonts;
}
