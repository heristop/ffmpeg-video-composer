// Fonts of an HTML layer come from the template's own faces (`global.fonts`, core/html/template-fonts.ts) and
// the engine's font registry (core/fonts.ts): a `font-family` stack resolves to its first family a template
// declares, else its first registry family (by family name, label, id or file); generic families map onto
// bundled faces, and anything else falls back to the default family and is reported (html_font_unknown).
// A template's family wins over a registry family of the same name.

import { FONTS, findFont, findFontByFile, type FontEntry } from '../fonts';
import { resolveTheme } from '../theme/resolve';
import type { ThemeSpec } from '../theme/themes';
import { styleValue, type LayerElement } from './html-element';
import type { CustomFontFace } from './template-fonts';

export interface LayerFontFace {
  /** The CSS family name (registry or template), as the layer's styles now spell it. */
  family: string;
  /** The registry's `.ttf` file, or a template face's file (CustomFontFace.file). */
  file: string;
  /** The weights text may ask for; a variable face is instanced at each, a static one used as it is. */
  weights: number[];
  /** A template face's declared weight: the weight it is registered under (a variable face is pinned to it). */
  weight?: number;
  /** A template face's declared style. */
  style?: 'normal' | 'italic';
}

export interface ResolvedStack {
  /** The family the stack resolves to (a template's or the registry's); null for the default family. */
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

function customNamed(name: string, custom: readonly CustomFontFace[]): string | undefined {
  const wanted = name.toLowerCase();

  return custom.find((face) => face.family.toLowerCase() === wanted)?.family;
}

/** The family of a CSS `font-family` stack (template faces first, then the registry), and the names nothing resolves. */
export function resolveFontStack(stack: string, custom: readonly CustomFontFace[] = []): ResolvedStack {
  const unknown: string[] = [];
  const names = stack
    .split(',')
    .map((name) => name.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);

  for (const name of names) {
    const lowered = name.toLowerCase();
    const declared = customNamed(name, custom);

    if (declared !== undefined) return { family: declared, unknown };

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
  custom: readonly CustomFontFace[];
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
    const resolved = resolveFontStack(stack, walk.custom);
    style.fontFamily = resolved.family ?? walk.defaultFamily;
    walk.families.add(style.fontFamily);

    for (const name of resolved.unknown) if (!walk.unknown.includes(name)) walk.unknown.push(name);
  }

  const children = element.props.children?.map((child) => (typeof child === 'string' ? child : rewrite(child, walk)));

  return { type: element.type, props: { ...element.props, style, ...(children && { children }) } };
}

function facesOf(family: string, weights: number[], custom: readonly CustomFontFace[]): LayerFontFace[] {
  const declared = custom.filter((face) => face.family === family);

  if (declared.length > 0) {
    return declared.map((face) => ({
      family,
      file: face.file,
      weights,
      ...(face.weight !== undefined && { weight: face.weight }),
      ...(face.style !== undefined && { style: face.style }),
    }));
  }

  const entry = entryNamed(family);

  return entry ? [{ family: entry.cssFamily, file: entry.file, weights }] : [];
}

/**
 * The layer with every `font-family` rewritten to a template or registry family, the faces (and weights) to
 * load, and the families nothing resolved. `defaultFamily` is a registry CSS family; `custom` are the
 * template's declared faces (`global.fonts`), which win over a registry family of the same name.
 */
export function layerFonts(
  element: LayerElement,
  defaultFamily: string,
  custom: readonly CustomFontFace[] = []
): { element: LayerElement; faces: LayerFontFace[]; unknown: string[] } {
  const walk: Walk = {
    custom,
    defaultFamily,
    families: new Set([defaultFamily]),
    weights: new Set(BASE_WEIGHTS),
    unknown: [],
  };
  const rewritten = rewrite(element, walk);
  const weights = [...walk.weights].sort((a, b) => a - b);
  const faces = [...walk.families].sort().flatMap((family) => facesOf(family, weights, custom));

  return { element: rewritten, faces, unknown: walk.unknown };
}

/** The CSS family an HTML layer's text falls back to: the theme's body font (`global.theme`). */
export function defaultHtmlFamily(global: unknown): string {
  const spec = global !== null && typeof global === 'object' ? (global as { theme?: ThemeSpec }).theme : undefined;
  const body = resolveTheme(spec)?.fonts.body ?? 'rubik';
  const entry = body.endsWith('.ttf') ? findFontByFile(body) : findFont(body);

  return entry?.cssFamily ?? 'Rubik';
}
