// A brand kit as a theme: its colours become palette clusters weighted by use, the reference-style role
// assignment picks bg / fg / brand / accent with WCAG contrast, and its fonts map to the nearest bundled
// font (so the theme renders on every platform) with the exact families kept as FontRef suggestions.

import { FONTS, type FontRef } from '../fonts';
import { assignRoles } from '../style/roles';
import { chroma, hexToRgb, hue, rgbToOklab } from '../style/oklab';
import type { PaletteCluster, ThemeRoles } from '../style/types';
import { THEME_COLOR_NAMES, type ThemeColors, type ThemeInput } from '../theme/themes';
import type { BrandKit } from './types';

type FontRole = 'display' | 'body' | 'mono';

export interface BrandTheme {
  theme: ThemeInput;
  fontRefs: Partial<Record<FontRole, FontRef>>;
  roles: ThemeRoles;
}

export const BRAND_HEADING =
  'Brand kit (BINDING: the user’s own brand. Use its theme, name and logo as given; never recolour or ' +
  'redraw the logo):';

/** A site name is untrusted text bound into prompt rules: one line, at most this many characters. */
export const MAX_BRAND_NAME = 80;

// Whitespace (line and paragraph separators included) and control characters.
const NAME_BREAKS = /[\s\p{Cc}]+/gu;

/** The name on one line (whitespace and control characters collapsed), capped with an ellipsis; null if empty. */
export function sanitizeBrandName(name: string | null): string | null {
  const flat = (name ?? '').replace(NAME_BREAKS, ' ').trim();
  const chars = Array.from(new Intl.Segmenter().segment(flat), (part) => part.segment);

  if (chars.length === 0) return null;

  if (chars.length <= MAX_BRAND_NAME) return flat;

  return `${chars
    .slice(0, MAX_BRAND_NAME - 1)
    .join('')
    .trimEnd()}…`;
}

// Headings default to the base theme's condensed face, which the bundled templates are sized for; a wide
// face only when the brand's own family says it is one.
const DEFAULT_FONT: Record<FontRole, string> = { display: 'bebas', body: 'rubik', mono: 'mono' };
const WIDE_FACE = /(?:^|[^a-z])(?:black|heavy|extended|wide)(?![a-z])/;

function cluster(hex: string, share: number): PaletteCluster {
  const { r, g, b } = hexToRgb(hex);
  const lab = rgbToOklab(r, g, b);

  return { lab, hex, share, chroma: chroma(lab), hue: hue(lab) };
}

export function nearestBundledFont(family: string | null, role: FontRole): string {
  if (family === null) return DEFAULT_FONT[role];

  const exact = FONTS.find((font) => font.cssFamily.toLowerCase() === family.toLowerCase());

  if (exact) return exact.id;

  const name = family.toLowerCase();

  if (role === 'mono' || /mono|code/.test(name)) return 'mono';

  if (/serif|garamond|playfair|times|georgia|didot|bodoni/.test(name) && !name.includes('sans')) return 'playfair';

  if (/condensed|compressed|narrow/.test(name)) return 'oswald';

  if (role === 'display' && WIDE_FACE.test(name)) return 'archivo-black';

  return DEFAULT_FONT[role];
}

/**
 * The colours a palette is built from: the site's most used, like an image's main clusters. A design system's
 * long tail of token shades would otherwise dilute its brand colour below the accent's minimum share.
 */
const PALETTE_SIZE = 16;

export function brandTheme(kit: BrandKit): BrandTheme {
  const used = kit.colors.toSorted((a, b) => b.weight - a.weight).slice(0, PALETTE_SIZE);
  const total = used.reduce((sum, color) => sum + color.weight, 0) || 1;
  const palette = used.map((color) => cluster(color.hex, color.weight / total));
  const { roles } = assignRoles(palette.length > 0 ? palette : [cluster('#ffffff', 1)]);
  const colors = Object.fromEntries(THEME_COLOR_NAMES.map((name) => [name, roles[name].hex])) as ThemeColors;
  const fontRefs: Partial<Record<FontRole, FontRef>> = {};

  for (const role of ['display', 'body', 'mono'] as const) {
    const family = kit.fonts[role];

    if (family && !FONTS.some((font) => font.cssFamily.toLowerCase() === family.toLowerCase())) {
      fontRefs[role] = { family };
    }
  }

  return {
    theme: {
      extends: 'leclap',
      colors,
      fonts: {
        display: nearestBundledFont(kit.fonts.display, 'display'),
        body: nearestBundledFont(kit.fonts.body, 'body'),
        mono: nearestBundledFont(kit.fonts.mono, 'mono'),
      },
    },
    fontRefs,
    roles,
  };
}

export function brandPromptRules(kit: BrandKit, brand: BrandTheme, logoPath?: string): string {
  const refs = Object.entries(brand.fontRefs).map(([role, ref]) => `${role} ${JSON.stringify(ref)}`);

  return [
    BRAND_HEADING,
    `- Brand: ${sanitizeBrandName(kit.name) ?? new URL(kit.url).hostname}. Write its name exactly so.`,
    `- Set global.theme to exactly: ${JSON.stringify(brand.theme)}`,
    ...(refs.length > 0
      ? [`- Exact brand fonts, for text fields that take a font object (Node and phone renders): ${refs.join('; ')}.`]
      : []),
    ...(logoPath
      ? [
          `- Logo: "${logoPath}". Show it on the opening and the closing as an image layer, never recoloured or cropped.`,
        ]
      : []),
  ].join('\n');
}
