// Theme resolution, run once per compile in the same pre-lowering pass as the motion tokens
// (director/prepare-build.ts): every whole-value `$color.<name>[@alpha]` / `$font.<name>` string in
// `global` and `sections` becomes its concrete value, and the theme's motion feel fills the
// `global.motion` defaults the template left unset. Lowering downstream only ever sees hex colours and
// font files, so a themed template renders exactly like its literal twin.

import { findFont } from '../fonts';
import { easingError, type EasingSpec } from '../motion/easing';
import { resolveEasingRef, resolveTokens, type MotionTokenSet } from '../motion/tokens';
import {
  BUILTIN_THEMES,
  DEFAULT_THEME,
  THEME_COLOR_NAMES,
  THEME_FONT_NAMES,
  type ResolvedTheme,
  type ThemeColors,
  type ThemeFonts,
  type ThemeInput,
  type ThemeSpec,
} from './themes';

/** The longest `extends` chain followed; deeper (or cyclic) chains are unknown themes. */
const MAX_EXTENDS_DEPTH = 8;

/** The token grammar: namespace, name, optional `@alpha` (colours only). Whole values only. */
const THEME_REF = /^\$(color|font)\.([a-z][a-z0-9-]*)(?:@(\d*\.?\d+))?$/;

/** True when the string mentions the theme namespaces at all (whole token or not). */
export function mentionsThemeToken(value: string): boolean {
  return value.includes('$color.') || value.includes('$font.');
}

// The base a chain's root layers onto: a root built-in states every token itself.
const ROOT: ResolvedTheme = { name: '', colors: {} as ThemeColors, fonts: {} as ThemeFonts, radius: 0, motion: {} };

function layer(base: ResolvedTheme, input: ThemeInput, name: string): ResolvedTheme {
  return {
    name,
    colors: { ...base.colors, ...input.colors },
    fonts: { ...base.fonts, ...input.fonts },
    radius: input.radius ?? base.radius,
    motion: { ...base.motion, ...input.motion },
  };
}

function builtin(name: string, depth: number): ResolvedTheme | undefined {
  if (depth > MAX_EXTENDS_DEPTH || !Object.hasOwn(BUILTIN_THEMES, name)) return undefined;

  const input = BUILTIN_THEMES[name];

  if (input.extends === undefined) return layer(ROOT, input, name);

  const base = builtin(input.extends, depth + 1);

  return base && layer(base, input, name);
}

/** The full theme a spec names, following `extends`; undefined when a name in the chain is unknown. */
export function resolveTheme(spec: ThemeSpec | undefined): ResolvedTheme | undefined {
  if (spec === undefined) return builtin(DEFAULT_THEME, 0);

  if (typeof spec === 'string') return builtin(spec, 0);

  const base = builtin(spec.extends ?? DEFAULT_THEME, 0);

  return base && layer(base, spec, base.name);
}

export interface ThemeRef {
  namespace: 'color' | 'font';
  name: string;
  alpha?: number;
}

/** A whole-value theme token, parsed; null when the string is not one. */
export function parseThemeRef(value: string): ThemeRef | null {
  const match = THEME_REF.exec(value.trim());

  if (!match) return null;

  return {
    namespace: match[1] as ThemeRef['namespace'],
    name: match[2],
    ...(match[3] ? { alpha: Number(match[3]) } : {}),
  };
}

function fontValue(font: string, key: string): string {
  if (key !== 'fontfile' || font.endsWith('.ttf')) return font;

  return findFont(font)?.file ?? font;
}

/**
 * The concrete value of a theme token in a field named `key`: a hex colour (with FFmpeg's `@alpha`
 * suffix when given), or a font id — a `.ttf` file name in a `fontfile` field. Undefined when the token
 * does not resolve (unknown name, alpha on a font, alpha out of 0..1); validation reports why.
 */
export function resolveThemeRef(ref: ThemeRef, theme: ResolvedTheme, key = ''): string | undefined {
  if (ref.namespace === 'font') {
    const known = ref.alpha === undefined && (THEME_FONT_NAMES as readonly string[]).includes(ref.name);

    return known ? fontValue(theme.fonts[ref.name as keyof ResolvedTheme['fonts']], key) : undefined;
  }

  if (!(THEME_COLOR_NAMES as readonly string[]).includes(ref.name)) return undefined;

  const hex = theme.colors[ref.name as keyof ResolvedTheme['colors']];

  if (ref.alpha === undefined) return hex;

  return ref.alpha <= 1 ? `${hex}@${ref.alpha}` : undefined;
}

function resolveString(value: string, theme: ResolvedTheme, key: string): string {
  const ref = parseThemeRef(value);

  return (ref && resolveThemeRef(ref, theme, key)) ?? value;
}

function resolveNode(value: unknown, theme: ResolvedTheme, key: string): unknown {
  if (typeof value === 'string') return resolveString(value, theme, key);

  if (Array.isArray(value)) return value.map((item) => resolveNode(item, theme, key));

  if (value === null || typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};

  for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
    out[childKey] = resolveNode(child, theme, childKey);
  }

  return out;
}

// The `$theme` curve to add: the theme ease resolved against the motion tokens, unless the template
// already defines `theme` itself or the ease does not parse (validation reports it).
function themeEase(motion: MotionTokenSet | undefined, ease: EasingSpec | undefined): EasingSpec | undefined {
  const taken = Object.hasOwn(motion?.curves ?? {}, 'theme') || Object.hasOwn(motion?.springs ?? {}, 'theme');

  if (taken || ease === undefined) return undefined;

  const spec = resolveEasingRef(ease, resolveTokens(motion));

  return easingError(spec) === null ? spec : undefined;
}

/**
 * `global.motion` with the theme's feel filling what the template left unset: `energy`, the `$theme`
 * easing token (from `theme.motion.ease`, itself resolvable against the motion tokens) and the `$beat`
 * duration token. Explicit `global.motion` values always win.
 */
export function themedMotion(motion: MotionTokenSet | undefined, theme: ResolvedTheme): MotionTokenSet | undefined {
  const { energy, ease, beat } = theme.motion;
  const out: MotionTokenSet = { ...motion };

  if (out.energy === undefined && energy !== undefined) out.energy = energy;

  const spec = themeEase(motion, ease);

  if (spec !== undefined) out.curves = { ...out.curves, theme: spec };

  if (beat !== undefined && !Object.hasOwn(out.durations ?? {}, 'beat')) out.durations = { ...out.durations, beat };

  return Object.keys(out).length > 0 ? out : motion;
}

function resolveGlobal(global: Record<string, unknown>, theme: ResolvedTheme): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, child] of Object.entries(global)) {
    out[key] = key === 'theme' || key === 'motion' ? child : resolveNode(child, theme, key);
  }

  if (global.theme === undefined) return out;

  const motion = themedMotion(global.motion as MotionTokenSet | undefined, theme);

  return motion === undefined ? out : { ...out, motion };
}

/**
 * The descriptor with every theme token resolved and the theme's motion defaults merged into
 * `global.motion`. Without `global.theme`, tokens resolve against the brand theme and motion is left
 * alone. An unknown theme leaves the descriptor untouched (validation reports `unknown_theme`).
 */
export function resolveThemeDescriptor<T extends { global?: unknown; sections?: unknown }>(descriptor: T): T {
  const global = descriptor.global as Record<string, unknown> | undefined;
  const theme = resolveTheme(global?.theme as ThemeSpec | undefined);

  if (!theme) return descriptor;

  return {
    ...descriptor,
    ...(global && { global: resolveGlobal(global, theme) }),
    ...(descriptor.sections !== undefined && { sections: resolveNode(descriptor.sections, theme, 'sections') }),
  };
}
