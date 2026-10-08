// Theme tokens inside CSS text: an HTML layer's `css` and `html` (its style attributes) mention tokens in
// the middle of declarations (`background: $color.surface; font: 600 28px $font.body`), where everywhere
// else a token is the whole value. Each is replaced by its CSS spelling: a hex colour (rgba() with an
// `@alpha`), or a font's quoted CSS family. A token that does not resolve stays; validation names it.

import { findFont, findFontByFile } from '../fonts';
import { THEME_COLOR_NAMES, THEME_FONT_NAMES, type ResolvedTheme } from './themes';

/** The descriptor keys whose strings are CSS text with embedded tokens. */
export const EMBEDDED_TOKEN_KEYS: ReadonlySet<string> = new Set(['css', 'html']);

const EMBEDDED = /\$(color|font)\.([a-z][a-z0-9-]*)(?:@(\d*\.?\d+))?/g;

/** Every token mentioned in a CSS text, as written. */
export function embeddedThemeTokens(text: string): string[] {
  return [...text.matchAll(EMBEDDED)].map((match) => match[0]);
}

function rgba(hex: string, alpha: number): string {
  const digits = hex.replace('#', '');
  const channels = [0, 2, 4].map((at) => Number.parseInt(digits.slice(at, at + 2), 16));

  return `rgba(${channels.join(', ')}, ${alpha})`;
}

function cssColor(theme: ResolvedTheme, name: string, alpha: string | undefined): string | undefined {
  if (!(THEME_COLOR_NAMES as readonly string[]).includes(name)) return undefined;

  const hex = theme.colors[name as keyof ResolvedTheme['colors']];

  if (alpha === undefined) return hex;

  const value = Number(alpha);

  return value <= 1 && /^#[\da-f]{6}$/i.test(hex) ? rgba(hex, value) : undefined;
}

function cssFont(theme: ResolvedTheme, name: string, alpha: string | undefined): string | undefined {
  if (alpha !== undefined || !(THEME_FONT_NAMES as readonly string[]).includes(name)) return undefined;

  const font = theme.fonts[name as keyof ResolvedTheme['fonts']];
  const family = (font.endsWith('.ttf') ? findFontByFile(font) : findFont(font))?.cssFamily;

  return `"${family ?? font}"`;
}

/** CSS text with every token it mentions replaced by its CSS value. */
export function resolveEmbeddedTokens(text: string, theme: ResolvedTheme): string {
  if (!text.includes('$')) return text;

  return text.replace(EMBEDDED, (match, namespace: string, name: string, alpha?: string) => {
    const value = namespace === 'color' ? cssColor(theme, name, alpha) : cssFont(theme, name, alpha);

    return value ?? match;
  });
}
