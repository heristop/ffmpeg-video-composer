// palette_drift (advisory): a themed template should draw from its theme. Once `global.theme` is set,
// literal hex colours outside the theme palette (alpha ignored, near-identical shades tolerated) and
// more than MAX_FONT_FAMILIES distinct fonts read as drift — usually a model or an author falling back
// to habit (#000/#fff, a third typeface). Guidance only: it never fails validation.

import { findFont, isFontRef } from '../fonts';
import { parseThemeRef, resolveTheme } from './resolve';
import { THEME_COLOR_NAMES, type ResolvedTheme, type ThemeSpec } from './themes';

/** Largest per-channel difference (0–255) at which a literal still counts as a palette colour. */
export const PALETTE_DRIFT_DELTA = 8;
/** Distinct font families/files a themed template may use before the advisory fires. */
export const MAX_FONT_FAMILIES = 2;

export interface PaletteWarning {
  path: string;
  message: string;
  code: 'palette_drift';
  severity: 'warn';
  hint: string;
}

const HINT = 'use $color.* / $font.* tokens';
const HEX = /^(?:#|0x)([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})(?:@\d*\.?\d+)?$/i;
const FONT_KEYS = new Set(['font', 'fontfile']);
// global keys that are not looks: the theme itself and the motion token set.
const SKIPPED_GLOBAL = new Set(['theme', 'motion']);

type Rgb = [number, number, number];

/** The RGB of a literal hex colour (`#rgb`, `#rrggbb`, `#rrggbbaa`, `0x…`, any `@alpha`); null otherwise. */
export function parseHexColor(value: string): Rgb | null {
  const digits = HEX.exec(value.trim())?.[1];

  if (digits === undefined) return null;

  const full = digits.length === 3 ? digits.replace(/./g, '$&$&') : digits.slice(0, 6);

  return [0, 2, 4].map((offset) => Number.parseInt(full.slice(offset, offset + 2), 16)) as Rgb;
}

function near(a: Rgb, b: Rgb): boolean {
  return a.every((channel, index) => Math.abs(channel - b[index]) <= PALETTE_DRIFT_DELTA);
}

function themePalette(theme: ResolvedTheme): Rgb[] {
  return THEME_COLOR_NAMES.map((name) => parseHexColor(theme.colors[name])).filter((rgb): rgb is Rgb => rgb !== null);
}

// One font identity per family: registry ids and their files collapse; `$font.*` resolves first.
function fontKey(value: unknown, theme: ResolvedTheme): string | null {
  if (isFontRef(value)) return `family:${value.family.trim().toLowerCase()}`;

  if (typeof value !== 'string' || value.trim() === '') return null;

  const ref = parseThemeRef(value);
  // An unknown `$font.*` name resolves to nothing (validation reports it).
  const fonts: Record<string, string | undefined> = theme.fonts;
  const name = ref?.namespace === 'font' ? fonts[ref.name] : value;

  if (name === undefined) return null;

  return (findFont(name)?.file ?? name).toLowerCase();
}

interface Scan {
  theme: ResolvedTheme;
  palette: Rgb[];
  drift: Map<string, string[]>;
  fonts: Set<string>;
}

function scanString(value: string, owner: string, scan: Scan): void {
  const rgb = parseHexColor(value);

  if (rgb === null || scan.palette.some((color) => near(color, rgb))) return;

  const list = scan.drift.get(owner) ?? [];
  const literal = value.trim().split('@')[0].toLowerCase();

  if (!list.includes(literal)) list.push(literal);

  scan.drift.set(owner, list);
}

function walk(value: unknown, key: string, owner: string, scan: Scan): void {
  if (FONT_KEYS.has(key)) {
    const font = fontKey(value, scan.theme);

    if (font !== null) scan.fonts.add(font);

    if (isFontRef(value)) return;
  }

  if (typeof value === 'string') {
    scanString(value, owner, scan);

    return;
  }

  if (value === null || typeof value !== 'object') return;

  for (const [childKey, child] of Object.entries(value)) walk(child, childKey, owner, scan);
}

function driftWarning(owner: string, colours: string[]): PaletteWarning {
  return {
    path: owner,
    code: 'palette_drift',
    severity: 'warn',
    message: `${owner}: ${colours.join(', ')} ${colours.length === 1 ? 'is' : 'are'} not in the theme palette`,
    hint: `${HINT} (e.g. "$color.fg", "$color.bg@0.6") so the palette stays one system`,
  };
}

function fontWarning(fonts: Set<string>): PaletteWarning {
  return {
    path: 'sections',
    code: 'palette_drift',
    severity: 'warn',
    message: `${fonts.size} font families in a themed template (${[...fonts].join(', ')}); keep it to ${MAX_FONT_FAMILIES}`,
    hint: `${HINT} ($font.display for headlines, $font.body for the rest)`,
  };
}

interface Loose {
  global?: Record<string, unknown> & { theme?: ThemeSpec };
  sections?: unknown[];
}

/** Off-palette colours (per section / global) and too many font families, for a themed template. */
export function findPaletteDrift(template: Loose): PaletteWarning[] {
  const spec = template.global?.theme;
  const theme = spec === undefined ? undefined : resolveTheme(spec);

  if (theme === undefined) return [];

  const scan: Scan = { theme, palette: themePalette(theme), drift: new Map(), fonts: new Set() };

  for (const [key, child] of Object.entries(template.global ?? {})) {
    if (!SKIPPED_GLOBAL.has(key)) walk(child, key, 'global', scan);
  }

  for (const [index, section] of (template.sections ?? []).entries()) walk(section, '', `sections[${index}]`, scan);

  const warnings = [...scan.drift].map(([owner, colours]) => driftWarning(owner, colours));

  return scan.fonts.size > MAX_FONT_FAMILIES ? [...warnings, fontWarning(scan.fonts)] : warnings;
}

/** The palette advisory for the motion warning list; like the rest of that list it never throws. */
export function paletteAdvisories(template: unknown): PaletteWarning[] {
  try {
    return findPaletteDrift(template as Loose);
  } catch {
    return [];
  }
}
