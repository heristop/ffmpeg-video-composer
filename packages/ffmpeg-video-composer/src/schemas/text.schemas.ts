import { z } from 'zod';
import { RevealSchema, TextEffectSchema } from './effects.schemas';
import { TranslationSchema, FontInputSchema } from './global.schemas';

// Author-facing text sugar — caption, title card and lower third. Each lowers to drawtext/drawbox/fade
// filters via the text presets (editor/presets/captions.ts, text-blocks.ts), so authors describe intent
// (kicker/headline/accent/reveal) instead of hand-writing positioned drawtext + timing expressions.

// ── caption ────────────────────────────────────────────────────────────────────

export const CAPTION_STYLES = ['bar', 'subtle', 'bold'] as const;
export const CAPTION_POSITIONS = ['top', 'center', 'bottom', 'lower-third'] as const;
export const CAPTION_ALIGNS = ['left', 'center', 'right'] as const;

// A styled lower-third / overlay caption. The `style` preset sets the base look; the optional
// fields override it. Consumed by the caption preset (editor/presets/captions.ts), which turns this
// into a single drawtext filter.
export const CaptionSchema = z
  .object({
    text: TranslationSchema.describe('Localised caption text; the active locale is resolved downstream.'),
    style: z.enum(CAPTION_STYLES).optional().describe('Visual preset for the caption (default "bar").'),
    position: z
      .enum(CAPTION_POSITIONS)
      .optional()
      .describe('Vertical placement of the caption (default "lower-third").'),
    align: z.enum(CAPTION_ALIGNS).optional().describe('Horizontal alignment of the caption (default "center").'),
    font: FontInputSchema.optional().describe(
      'Font id (bundled registry), a raw .ttf filename, or { family, weight, style } to resolve any ' +
        'Google Fonts family; overrides the preset font.'
    ),
    fontsize: z.number().positive().optional().describe('Font size in px; overrides the preset size.'),
    color: z.string().optional().describe('Text colour as a CSS hex string; overrides the preset colour.'),
    box: z
      .boolean()
      .optional()
      .describe('When true, draws a background box behind the text (preset default otherwise).'),
    boxColor: z.string().optional().describe('Box colour as a CSS hex string when the box is on.'),
    boxOpacity: z.number().min(0).max(1).optional().describe('Box opacity 0..1 when the box is on.'),
    reveal: RevealSchema.optional().describe('Animated entrance for the caption (fade/rise/slide); default none.'),
    effect: TextEffectSchema.optional().describe('Drop shadow / outline for legibility over busy footage.'),
  })
  .strict()
  .describe('A styled lower-third / overlay caption rendered as a drawtext filter.');

export type Caption = z.infer<typeof CaptionSchema>;

// ── title card ───────────────────────────────────────────────────────────────────

// A per-line style override for a title card line. Every field is optional so the preset look
// (font / scale-derived size / colour) stays the default; set fields win over it.
export const TitleCardLineStyleSchema = z
  .object({
    font: FontInputSchema.optional().describe(
      'Font id (bundled registry), a raw .ttf filename, or { family, weight, style } to resolve any ' +
        'Google Fonts family; overrides the preset font.'
    ),
    fontsize: z.number().positive().optional().describe('Font size in px; overrides the scale-derived size.'),
    color: z.string().optional().describe('Text colour as a CSS hex string; overrides the preset colour.'),
  })
  .strict()
  .describe('Per-line font / size / colour override for a title card line.');

export type TitleCardLineStyle = z.infer<typeof TitleCardLineStyleSchema>;

// A kicker / headline / subtitle card for color_background sections. Lowered by the titleCard preset
// (editor/presets/text-blocks.ts) into the drawtext/drawbox/fade filters intros and outros used to
// author by hand. Positions and sizes are derived from the output scale so it renders in any orientation.
export const TitleCardSchema = z
  .object({
    kicker: TranslationSchema.optional().describe('Small eyebrow label above the headline.'),
    headline: TranslationSchema.optional().describe('Main headline, rendered large.'),
    subtitle: TranslationSchema.optional().describe('Supporting line below the headline.'),
    kickerStyle: TitleCardLineStyleSchema.optional().describe('Font / size / colour override for the kicker.'),
    headlineStyle: TitleCardLineStyleSchema.optional().describe('Font / size / colour override for the headline.'),
    subtitleStyle: TitleCardLineStyleSchema.optional().describe('Font / size / colour override for the subtitle.'),
    accent: z.string().optional().describe('Accent colour: draws an underline bar and tints the kicker.'),
    align: z.enum(['left', 'center']).optional().describe('Horizontal alignment of the card (default left).'),
    background: z.string().optional().describe('Fade colour; defaults to the section background colour.'),
    reveal: RevealSchema.optional().describe('Entrance for the lines, staggered top-to-bottom (default "rise").'),
    stagger: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe(
        'Seconds between non-empty line entrances, 0..1 (default 0.15). Zero reveals all lines together; the accent follows its line.'
      ),
    effect: TextEffectSchema.optional().describe('Drop shadow / outline applied to every line for legibility.'),
    fade: z
      .object({
        in: z.boolean().optional().describe('Auto fade-in over the card (default true).'),
        out: z.boolean().optional().describe('Auto fade-out over the card (default true).'),
      })
      .strict()
      .optional()
      .describe('Auto fade-in / fade-out behaviour for the card.'),
  })
  .strict()
  .describe('A kicker / headline / subtitle title card rendered onto a color_background section.');

// ── lower third ────────────────────────────────────────────────────────────────

// A title/subtitle band composited over a clip. Lowered by the lowerThird preset
// (editor/presets/text-blocks.ts) into the drawbox/drawtext filters that used to require inputs/maps/@name.
export const LowerThirdSchema = z
  .object({
    title: TranslationSchema.optional().describe('Main line of the lower third.'),
    subtitle: TranslationSchema.optional().describe('Supporting line below the title.'),
    accent: z.string().optional().describe('Accent colour: draws an accent bar and the badge background.'),
    bandColor: z
      .string()
      .optional()
      .describe('Legibility band colour as a CSS hex string (default near-black #0a0f14).'),
    boxOpacity: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe('Legibility band opacity 0..1 (default 0.6; 0 = no band).'),
    position: z.enum(['bottom', 'top']).optional().describe('Vertical anchor of the band (default bottom).'),
    badge: TranslationSchema.optional().describe('Optional right-aligned pill (price, step number, badge).'),
    reveal: RevealSchema.optional().describe('Entrance for the lines, staggered (default "rise").'),
    effect: TextEffectSchema.optional().describe(
      'Drop shadow / outline applied to the title + subtitle for legibility.'
    ),
  })
  .strict()
  .describe('A title/subtitle lower-third band composited over a clip.');
