// Fonts of an HTML layer come from the engine's font registry (core/fonts.ts) only: a `font-family` stack
// resolves to its first registry family (by family name, label, id or file), generic families map onto
// bundled faces, and anything else falls back to the default family and is reported (html_font_unknown).

import { FONTS, findFont, findFontByFile, type FontEntry } from '../fonts';
import { resolveTheme } from '../theme/resolve';
import type { ThemeSpec } from '../theme/themes';
import { styleValue, type LayerElement } from './html-element';

export interface LayerFontFace {
  /** The registry's CSS family name, as the layer's styles now spell it. */
  family: string;
  /** The registry's `.ttf` file. */
  file: string;
  /** The weights text may ask for; a variable face is instanced at each, a static one used as it is. */
  weights: number[];
}

export interface ResolvedStack {
  /** The registry family the stack resolves to; null for the default family. */
  family: string | null;
  unknown: string[];
}

const GENERIC: Readonly<Record<string, string | null>> = {
  'sans-serif': null,
  'system-ui': null,
  'ui-sans-serif': null,
  serif: 'Playfair Display',
  'ui-serif': 'Playfair Display',
  monospace: 'Roboto Mono',
  'ui-monospace': 'Roboto Mono',
  cursive: 'Pacifico',
};

const NAMED_WEIGHTS: Readonly<Record<string, number>> = { normal: 400, bold: 700, bolder: 700, lighter: 300 };

// Bold text (headings, <strong>) needs 700 whatever the styles say.
const BASE_WEIGHTS = [400, 700];

function entryNamed(name: string): FontEntry | undefined {
  const wanted = name.toLowerCase();

  return FONTS.find(
    (font) =>
      font.cssFamily.toLowerCase() === wanted ||
      font.label.toLowerCase() === wanted ||
      font.id === wanted ||
      font.file.toLowerCase() === wanted
  );
}

/** The registry family of a CSS `font-family` stack, and the names in it nothing resolves. */
export function resolveFontStack(stack: string): ResolvedStack {
  const unknown: string[] = [];
  const names = stack
    .split(',')
    .map((name) => name.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);

  for (const name of names) {
    const lowered = name.toLowerCase();

    if (Object.hasOwn(GENERIC, lowered)) return { family: GENERIC[lowered], unknown };

    const entry = entryNamed(name);

    if (entry) return { family: entry.cssFamily, unknown };

    unknown.push(name);
  }

  return { family: null, unknown };
}

function weightOf(value: string | undefined): number | null {
  if (value === undefined) return null;

  const named = NAMED_WEIGHTS[value.toLowerCase()] as number | undefined;

  if (named !== undefined) return named;

  const numeric = Number(value);

  return Number.isInteger(numeric) && numeric >= 100 && numeric <= 900 ? numeric : null;
}

interface Walk {
  defaultFamily: string;
  families: Set<string>;
  weights: Set<number>;
  unknown: string[];
}

function rewrite(element: LayerElement, walk: Walk): LayerElement {
  const style = { ...element.props.style };
  const weight = weightOf(styleValue(style, 'fontWeight'));
  const stack = styleValue(style, 'fontFamily');

  if (weight !== null) walk.weights.add(weight);

  if (stack !== undefined) {
    const resolved = resolveFontStack(stack);
    style.fontFamily = resolved.family ?? walk.defaultFamily;
    walk.families.add(style.fontFamily);

    for (const name of resolved.unknown) if (!walk.unknown.includes(name)) walk.unknown.push(name);
  }

  const children = element.props.children?.map((child) => (typeof child === 'string' ? child : rewrite(child, walk)));

  return { type: element.type, props: { ...element.props, style, ...(children && { children }) } };
}

/**
 * The layer with every `font-family` rewritten to a registry family, the faces (and weights) to load,
 * and the families nothing resolved. `defaultFamily` is a registry CSS family.
 */
export function layerFonts(
  element: LayerElement,
  defaultFamily: string
): { element: LayerElement; faces: LayerFontFace[]; unknown: string[] } {
  const walk: Walk = { defaultFamily, families: new Set([defaultFamily]), weights: new Set(BASE_WEIGHTS), unknown: [] };
  const rewritten = rewrite(element, walk);
  const weights = [...walk.weights].sort((a, b) => a - b);
  const faces = [...walk.families].sort().flatMap((family) => {
    const entry = entryNamed(family);

    return entry ? [{ family: entry.cssFamily, file: entry.file, weights }] : [];
  });

  return { element: rewritten, faces, unknown: walk.unknown };
}

/** The CSS family an HTML layer's text falls back to: the theme's body font (`global.theme`). */
export function defaultHtmlFamily(global: unknown): string {
  const spec = global !== null && typeof global === 'object' ? (global as { theme?: ThemeSpec }).theme : undefined;
  const body = resolveTheme(spec)?.fonts.body ?? 'rubik';
  const entry = body.endsWith('.ttf') ? findFontByFile(body) : findFont(body);

  return entry?.cssFamily ?? 'Rubik';
}
