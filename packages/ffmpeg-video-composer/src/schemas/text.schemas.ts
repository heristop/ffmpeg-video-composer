import { z } from 'zod';
import { RevealSchema, TextEffectSchema } from './effects.schemas';
import { TranslationSchema, FontInputSchema } from './global.schemas';
import { MotionRoleSchema } from './motion.schemas';

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
    wrap: z
      .enum(['greedy', 'balanced'])
      .optional()
      .describe(
        'Wrap the caption to the frame (bundled fonts only), one drawtext per line. greedy fills each line; ' +
          'balanced keeps the line count but evens line widths and avoids ending a line on an article or ' +
          'preposition. Default: no wrapping (a single line).'
      ),
    fit: z
      .object({
        minSize: z
          .number()
          .min(8)
          .max(400)
          .optional()
          .describe('Smallest font size to shrink to (default 75% of the size).'),
        maxLines: z.number().int().min(1).max(4).optional().describe('Most lines the caption may take (default 2).'),
      })
      .strict()
      .optional()
      .describe('Shrink the font until the wrapped caption fits maxLines lines (implies wrap, greedy by default).'),
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
    role: MotionRoleSchema.optional(),
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

// ── counter ────────────────────────────────────────────────────────────────────

/** Locales whose digit grouping and decimal mark the counter knows; anything else formats as "en". */
export const COUNTER_LOCALES = ['en', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'de-CH', 'ja', 'zh', 'ko'] as const;

// The rolling number of a kinetic `counter` block (editor/presets/text-counter.ts). Its timing is the
// block's own (`delay`, `duration`, `ease`); these fields shape the number.
export const CounterSchema = z
  .object({
    from: z.number().min(0).max(1e11).describe('Start value (non-negative; use prefix "-" for negatives).'),
    to: z
      .number()
      .min(0)
      .max(1e11)
      .optional()
      .describe(
        'End value (non-negative). Shown exactly once the roll ends, and held. Omit it to roll up to the first ' +
          'number in the block `text` once form fields resolve ("{{ form_price }}" → "EUR 24", "24,90 €"): the ' +
          'text around it becomes the prefix/suffix, its separators set decimals, grouping and locale; text ' +
          'without a number fades in as is.'
      ),
    decimals: z.number().int().min(0).max(4).optional().describe('Digits after the decimal mark (default 0).'),
    prefix: z.string().max(12).optional().describe('Text before the number, e.g. "$" or "EUR ".'),
    suffix: z.string().max(12).optional().describe('Text after the number, e.g. "%" or " K".'),
    locale: z
      .enum(COUNTER_LOCALES)
      .optional()
      .describe(
        'Number formatting: the grouping separator and decimal mark (en 1,234.5; fr 1 234,5; de 1.234,5; ' +
          'de-CH 1’234.5). Default: the template’s active locale.'
      ),
    grouping: z
      .boolean()
      .optional()
      .describe(
        'Group thousands with the locale separator. Default: on when the largest value has 5+ integer digits ' +
          '(12,500), off below it so years and short figures (2024, 1500) stay plain.'
      ),
    tabular: z
      .boolean()
      .optional()
      .describe(
        'Tabular digits (default true): every digit sits in a fixed-width slot, so the number does not ' +
          'jitter sideways while it rolls; it only widens when it gains a digit. false draws proportional ' +
          'figures (tighter, but the width breathes every frame).'
      ),
    overshoot: z
      .number()
      .min(0)
      .max(0.1)
      .optional()
      .describe(
        'Run past the final value by this share of the travelled range, then settle back onto it inside the ' +
          'block duration (0..0.1, default 0). Keep it at 0.02–0.04 for a physical settle; visible only when ' +
          'the share is worth at least one shown unit.'
      ),
  })
  .strict()
  .describe(
    'counter preset: the rolling number (the block text is ignored unless `to` is omitted). It rolls over the block ' +
      '`delay` + `duration` on the block `ease` (a token such as "$expo", a cubic-bezier or a spring), lands ' +
      'exactly on `to` and holds. Without a block duration, the roll lasts 0.6–1.6 s, longer for bigger ranges.'
  );

export type CounterSpec = z.infer<typeof CounterSchema>;

// ── lower third ────────────────────────────────────────────────────────────────

export const LOWER_THIRD_STYLES = ['clean-bar', 'side-rule', 'kicker', 'stack-bars', 'pill'] as const;
export type LowerThirdStyle = (typeof LOWER_THIRD_STYLES)[number];

/** The reveal each lower-third style's lines use when the block sets none (lowering and timeline agree). */
export const LOWER_THIRD_STYLE_REVEALS: Record<LowerThirdStyle, 'fade' | 'rise' | 'slide-right'> = {
  'clean-bar': 'slide-right',
  'side-rule': 'slide-right',
  kicker: 'rise',
  'stack-bars': 'slide-right',
  pill: 'fade',
};

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
    style: z
      .enum(LOWER_THIRD_STYLES)
      .optional()
      .describe(
        'Layout and animation (default: the full-width band). clean-bar: tight boxes behind each line under an accent rule that draws itself. ' +
          'side-rule: no band, a vertical accent rule grows beside the lines. kicker: the subtitle becomes an accent label above the title, ' +
          'underlined by a drawn rule. stack-bars: an accent box for the title and a band box for the subtitle, sliding in one after the other. ' +
          'pill: a rounded pill grows from a dot and the lines fade in inside it. Each style has its own default reveal.'
      ),
    badge: TranslationSchema.optional().describe('Optional right-aligned pill (price, step number, badge).'),
    reveal: RevealSchema.optional().describe('Entrance for the lines, staggered (default "rise").'),
    role: MotionRoleSchema.optional(),
    effect: TextEffectSchema.optional().describe(
      'Drop shadow / outline applied to the title + subtitle for legibility.'
    ),
  })
  .strict()
  .describe('A title/subtitle lower-third band composited over a clip.');
