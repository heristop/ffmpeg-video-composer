// Theme rules beyond the schema:
//
// - unknown_theme: `global.theme` (or a name in its `extends` chain) is not a built-in theme.
// - unknown_theme_token: a `$color.*` / `$font.*` string that does not resolve, with the nearest name.
// - unknown_font: a theme font that is neither a bundled font id nor a `.ttf` file name.
// - unknown_motion_token / invalid_easing: a theme ease that does not parse.
// - accent_overuse (advisory, see findAccentOveruse): the accent on too many elements of one section.

import { findFont } from '../fonts';
import { easingError } from '../motion/easing';
import { resolveEasingRef, resolveTokens, type MotionTokenSet } from '../motion/tokens';
import { mentionsThemeToken, parseThemeRef, resolveTheme, resolveThemeRef } from './resolve';
import { BUILTIN_THEMES, THEME_COLOR_NAMES, THEME_FONT_NAMES, type ResolvedTheme, type ThemeSpec } from './themes';

// Structurally the validator's ValidationError (declared here so this module stays free of services).
interface ThemeIssue {
  path: string;
  message: string;
  code: string;
}

interface Loose {
  global?: { theme?: ThemeSpec; motion?: MotionTokenSet } & Record<string, unknown>;
  sections?: unknown[];
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i++) {
    const row = [i];

    for (let j = 1; j <= b.length; j++) {
      row.push(Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
    }

    previous = row;
  }

  return previous[b.length];
}

/** The closest candidate within a few edits, for "did you mean" messages. */
export function nearestName(name: string, candidates: readonly string[]): string | undefined {
  let best: { candidate: string; distance: number } | undefined;

  for (const candidate of candidates) {
    const distance = editDistance(name, candidate);

    if (!best || distance < best.distance) best = { candidate, distance };
  }

  return best && best.distance <= Math.max(2, Math.floor(name.length / 2)) ? best.candidate : undefined;
}

function didYouMean(name: string, candidates: readonly string[]): string {
  const near = nearestName(name, candidates);

  return near === undefined ? ` (known: ${candidates.join(', ')})` : `; did you mean "${near}"?`;
}

// The first name in the chain that is not a built-in, with the path it was authored at.
function unknownThemeIssue(spec: ThemeSpec): ThemeIssue | null {
  const names = Object.keys(BUILTIN_THEMES);
  const name = typeof spec === 'string' ? spec : spec.extends;
  const path = typeof spec === 'string' ? 'global.theme' : 'global.theme.extends';

  if (name === undefined || Object.hasOwn(BUILTIN_THEMES, name)) return null;

  return { path, message: `unknown theme "${name}"${didYouMean(name, names)}`, code: 'unknown_theme' };
}

function themeFontIssues(spec: ThemeSpec): ThemeIssue[] {
  const fonts = typeof spec === 'string' ? {} : (spec.fonts ?? {});

  return Object.entries(fonts)
    .filter(([, font]) => !font.endsWith('.ttf') && findFont(font) === undefined)
    .map(([name, font]) => ({
      path: `global.theme.fonts.${name}`,
      message: `theme font "${font}" is not a bundled font id or a .ttf file name`,
      code: 'unknown_font',
    }));
}

function themeEaseIssue(spec: ThemeSpec, motion: MotionTokenSet | undefined): ThemeIssue | null {
  const ease = typeof spec === 'string' ? undefined : spec.motion?.ease;

  if (ease === undefined) return null;

  const resolved = resolveEasingRef(ease, resolveTokens(motion));
  const path = 'global.theme.motion.ease';

  if (typeof resolved === 'string' && resolved.startsWith('$')) {
    return { path, message: `unknown motion token "${resolved}"`, code: 'unknown_motion_token' };
  }

  const message = easingError(resolved);

  return message ? { path, message, code: 'invalid_easing' } : null;
}

function tokenProblem(value: string, theme: ResolvedTheme): string | null {
  const ref = parseThemeRef(value);

  if (!ref) return `"${value}": theme tokens must be the whole value, like "$color.accent" or "$color.fg@0.6"`;

  if (resolveThemeRef(ref, theme) !== undefined) return null;

  if (ref.namespace === 'font' && ref.alpha !== undefined) return `"${value}": fonts take no @alpha`;

  const names = ref.namespace === 'color' ? THEME_COLOR_NAMES : THEME_FONT_NAMES;

  if (names.includes(ref.name as never)) return `"${value}": alpha must be between 0 and 1`;

  return `unknown theme ${ref.namespace} "${ref.name}"${didYouMean(ref.name, names)}`;
}

function collectTokenIssues(value: unknown, path: string, theme: ResolvedTheme, out: ThemeIssue[]): void {
  if (typeof value === 'string') {
    const problem = mentionsThemeToken(value) ? tokenProblem(value, theme) : null;

    if (problem) out.push({ path, message: problem, code: 'unknown_theme_token' });

    return;
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) collectTokenIssues(item, `${path}[${index}]`, theme, out);

    return;
  }

  if (value === null || typeof value !== 'object') return;

  for (const [key, child] of Object.entries(value)) {
    const own = path === 'global' && (key === 'theme' || key === 'motion');

    if (!own) collectTokenIssues(child, `${path}.${key}`, theme, out);
  }
}

/** Every theme error in a descriptor (schema-valid input assumed, as with the other descriptor rules). */
export function validateTheme(template: Loose): ThemeIssue[] {
  const spec = template.global?.theme;
  const unknown = spec === undefined ? null : unknownThemeIssue(spec);

  if (unknown) return [unknown];

  const theme = resolveTheme(spec) as ResolvedTheme;
  const issues: ThemeIssue[] = spec === undefined ? [] : themeFontIssues(spec);
  const ease = spec === undefined ? null : themeEaseIssue(spec, template.global?.motion);

  if (ease) issues.push(ease);

  collectTokenIssues(template.global, 'global', theme, issues);
  collectTokenIssues(template.sections, 'sections', theme, issues);

  return issues;
}
