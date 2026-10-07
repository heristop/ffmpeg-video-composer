import { z } from 'zod';
import { EasingSpecSchema } from './motion.schemas';
import { BUILTIN_THEMES, type ThemeColorName, type ThemeFontName } from '../core/theme/themes';

// ── theme tokens (core/theme) ───────────────────────────────────────────────────────────────────
//
// Shapes only. Whether a theme name exists, a `$color.*` / `$font.*` reference resolves, or a theme font
// is bundled are descriptor rules (core/theme/validate.ts), so they can name the nearest match.

const HexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'theme colours are #RRGGBB hex strings')
  .describe('A #RRGGBB hex colour.');

function color(role: string) {
  return HexColorSchema.optional().describe(role);
}

function font(role: string) {
  return z.string().trim().min(1).optional().describe(role);
}

const ThemeColorsSchema = z
  .object({
    bg: color('Canvas / background colour ($color.bg).'),
    fg: color('Primary text colour on bg ($color.fg).'),
    muted: color('Secondary text: kickers, captions, labels ($color.muted).'),
    surface: color('Raised plates, bands and panels over bg ($color.surface).'),
    brand: color('The brand colour: logos, rules, signature details ($color.brand).'),
    accent: color('The one highlight per idea: a word, a bar, a CTA ($color.accent).'),
    accent2: color('A rare second highlight ($color.accent2).'),
  } satisfies Record<ThemeColorName, z.ZodType>)
  .strict();

const ThemeFontsSchema = z
  .object({
    display: font('Headline face ($font.display): a bundled font id (bebas, oswald, …) or a .ttf file name.'),
    body: font('Supporting copy face ($font.body).'),
    mono: font('Code / data face ($font.mono).'),
  } satisfies Record<ThemeFontName, z.ZodType>)
  .strict();

export const ThemeObjectSchema = z
  .object({
    extends: z.string().trim().min(1).optional().describe('Built-in theme this one layers over (default "leclap").'),
    colors: ThemeColorsSchema.optional().describe('Colour tokens to override.'),
    fonts: ThemeFontsSchema.optional().describe('Font tokens to override.'),
    radius: z.number().min(0).max(200).optional().describe('Corner radius in output pixels for plates and panels.'),
    motion: z
      .object({
        energy: z.number().min(0).max(1.5).optional().describe('Default for global.motion.energy (0..1.5).'),
        ease: EasingSpecSchema.optional().describe('The $theme easing token, e.g. "$snappy" or "cubic-bezier(…)".'),
        beat: z.number().min(0.05).max(10).optional().describe('The $beat duration token, in seconds.'),
      })
      .strict()
      .optional()
      .describe('The motion feel: fills global.motion where the template leaves it unset.'),
  })
  .strict();

export const ThemeSchema = z
  .union([z.string().trim().min(1), ThemeObjectSchema])
  .describe(
    `Theme: a built-in name (${Object.keys(BUILTIN_THEMES).join(', ')}) or { extends, colors, fonts, ` +
      'radius, motion }. Reference its tokens anywhere as "$color.accent", "$color.bg@0.55" or "$font.display".'
  )
  .meta({ id: 'Theme' });

export type Theme = z.infer<typeof ThemeSchema>;
