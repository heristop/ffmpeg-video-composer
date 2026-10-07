import { z } from 'zod';
import { TranslationSchema } from './global.schemas';
import { TextEffectSchema } from './effects.schemas';
import { EasingSpecSchema, MotionRoleSchema } from './motion.schemas';
import { ElementIdSchema, timeValue } from './time.schemas';
import { CounterSchema } from './text.schemas';

// ── kinetic typography (docs/plans/motion-system.md §4.1) ──────────────────────
//
// One block = one piece of animated copy. Pick a preset; every other field is optional and has a
// preset-specific default, so `{ "text": { "en": "Make it move" }, "preset": "cascade" }` is a complete,
// good-looking block. Each word or glyph is drawn and animated on its own, natively (drawtext), so it
// renders on Node, WASM and on-device alike.

export const KINETIC_PRESETS = [
  'cascade',
  'rise',
  'drop',
  'slide',
  'pop',
  'impact',
  'tracking-in',
  'typewriter',
  'scramble',
  'wave',
  'highlight',
  'counter',
  'split',
  'fade',
] as const;

export const KINETIC_EXIT_PRESETS = ['none', 'fade', 'rise', 'drop', 'slide', 'shrink', 'cascade'] as const;
export const KINETIC_ORDERS = ['forward', 'reverse', 'center', 'edges', 'random'] as const;

const PRESET_DESCRIPTION =
  'Entrance choreography. cascade: words rise in sequence on a spring. rise / drop: travel up / down into ' +
  'place. slide: travel in from `direction`. pop: each unit springs up from small. impact: each unit slams ' +
  'down from oversized. tracking-in: wide letter-spacing collapses to tight (keynote title). typewriter: ' +
  'glyphs appear one by one behind a caret. scramble: glyphs decode from seeded random characters. wave: ' +
  'glyphs bob on a travelling sine after entering. highlight: words cascade in, then a marker sweeps behind ' +
  'the accent words. counter: a number rolls from `counter.from` to `counter.to`. split: each line enters ' +
  'from both sides and locks in the middle. fade: plain staggered fade.';

export const KineticExitSchema = z
  .object({
    preset: z.enum(KINETIC_EXIT_PRESETS).describe('How the block leaves (default fade). cascade = staggered rise-out.'),
    at: timeValue(z.number().min(0))
      .optional()
      .describe(
        'When the exit begins: seconds from the section start or a time reference ("end - 0.6"); default: ends with the section.'
      ),
    duration: z.number().positive().max(5).optional().describe('Seconds each unit takes to leave (default 0.35).'),
    stagger: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe('Seconds between units leaving (default: entrance stagger / 2).'),
    ease: EasingSpecSchema.optional().describe('Exit curve (default ease-in-cubic).'),
    distance: z.number().min(0).max(2000).optional().describe('Travel in px for rise/drop/slide/cascade exits.'),
  })
  .strict()
  .describe('Exit choreography for a kinetic block.');

const FillColorSchema = z
  .string()
  .regex(
    /^(?:[#$A-Za-z0-9@._]+|\{\{ ?color\d+ ?\}\})$/,
    'a colour: #RRGGBB, #RRGGBB@alpha, a name, $color.<token> or {{ colorN }}'
  );

export const KineticFillSchema = z
  .object({
    gradient: z
      .union([
        z
          .object({
            from: FillColorSchema.describe('Colour at the start of the sweep.'),
            to: FillColorSchema.describe('Colour at the end of the sweep.'),
            angle: z
              .number()
              .min(0)
              .max(360)
              .optional()
              .describe('CSS-style angle in degrees: 0 bottom→top, 90 left→right (default 90).'),
          })
          .strict(),
        z
          .object({
            stops: z.array(FillColorSchema).min(2).max(8).describe('2–8 colours spread evenly across the block.'),
            angle: z.number().min(0).max(360).optional().describe('CSS-style angle in degrees (default 90).'),
          })
          .strict(),
      ])
      .optional()
      .describe('Gradient across the text block: { from, to, angle? } or { stops: [...], angle? }.'),
    texture: z
      .string()
      .min(1)
      .optional()
      .describe('Image (URL or path) seen through the letters, cover-scaled to the frame; wins over gradient.'),
    sweep: z
      .object({
        duration: z.number().positive().max(10).optional().describe('Seconds per pass across the frame (default 1.2).'),
        width: z.number().positive().max(2000).optional().describe('Band width in px (default 60% of the font size).'),
        color: FillColorSchema.optional().describe('Highlight colour (default #FFFFFF@0.7).'),
        delay: z
          .number()
          .min(0)
          .max(60)
          .optional()
          .describe('Seconds from the section start of the first pass (default: when the last unit lands).'),
        every: z
          .number()
          .positive()
          .max(60)
          .optional()
          .describe('Seconds between pass starts; omit for a single pass.'),
      })
      .strict()
      .optional()
      .describe('Shimmer: a soft highlight band travelling left→right through the letters.'),
  })
  .strict()
  .refine(
    (fill) => [fill.gradient, fill.texture, fill.sweep].some((part) => part !== undefined),
    'set gradient, texture or sweep'
  )
  .describe(
    'Fill the letters with a gradient, a texture image and/or a shimmer sweep instead of a flat colour. Drawn ' +
      'as a mask (alphamerge), per-unit timing kept. Needs alphamerge: the on-device engine falls back to the ' +
      'solid colour with a warning when its build lacks it.'
  );

export const KineticBlockSchema = z
  .object({
    text: TranslationSchema.describe(
      'The copy, per locale. {{ variables }} and form fields resolve before layout. A newline forces a line break.'
    ),
    preset: z.enum(KINETIC_PRESETS).describe(PRESET_DESCRIPTION),
    unit: z
      .enum(['line', 'word', 'glyph'])
      .optional()
      .describe(
        'What animates independently (default per preset: word for cascade/pop/impact/highlight, glyph for tracking-in/typewriter/scramble/wave). ' +
          'Copy in a joining or right-to-left script (Arabic, Hebrew, Devanagari…) always animates per line.'
      ),
    order: z
      .enum(KINETIC_ORDERS)
      .optional()
      .describe('Stagger order (default forward). random is seeded by global.seed.'),
    id: ElementIdSchema.optional(),
    delay: timeValue(z.number().min(0).max(30))
      .optional()
      .describe(
        'When the first unit moves: seconds from the section start (default 0.2) or a time reference ("title.end + 0.1", "beat:4 - 0.1").'
      ),
    stagger: z
      .number()
      .min(0)
      .max(2)
      .optional()
      .describe('Seconds between units (default per preset, e.g. 0.07 per word, 0.035 per glyph).'),
    duration: z
      .number()
      .positive()
      .max(10)
      .optional()
      .describe('Seconds each unit takes to arrive. Omit with a spring ease to let physics decide.'),
    ease: EasingSpecSchema.optional().describe('Arrival curve (default per preset, e.g. $snappy, $bouncy, $expo).'),
    role: MotionRoleSchema.optional(),
    distance: z
      .number()
      .min(0)
      .max(2000)
      .optional()
      .describe('Travel in px (default per preset, scaled by global.motion.energy).'),
    direction: z
      .enum(['up', 'down', 'left', 'right'])
      .optional()
      .describe('Travel direction for slide (default left: enters moving left).'),
    font: z
      .string()
      .optional()
      .describe('Bundled font id or .ttf file (default bebas). Word/glyph units need a bundled font.'),
    size: z.number().positive().max(600).optional().describe('Font size in px (default 11% of the frame height).'),
    color: z.string().optional().describe('Text colour (default #F5F3F7); the fallback when `fill` cannot render.'),
    fill: KineticFillSchema.optional(),
    accent: z
      .object({
        words: z
          .union([z.array(z.number().int().min(0)).max(64), z.literal('last'), z.literal('first')])
          .describe('Zero-based word indices to accent, or "first" / "last".'),
        color: z.string().optional().describe('Accent text colour (default #FFF685).'),
        marker: z
          .string()
          .optional()
          .describe('Highlight marker colour behind accent words (highlight preset; default #7C83FD@0.85).'),
      })
      .strict()
      .optional()
      .describe('Emphasis for chosen words: a colour, and for the highlight preset a sweeping marker.'),
    align: z.enum(['left', 'center', 'right']).optional().describe('Line alignment (default center).'),
    x: z
      .number()
      .optional()
      .describe('Anchor x in px: left edge, centre or right edge per align (default frame centre / 8% margin).'),
    y: z
      .union([z.number(), z.enum(['top', 'center', 'bottom'])])
      .optional()
      .describe('Top of the block in px, or top / center / bottom inside the title-safe area (default center).'),
    maxWidth: z.number().positive().optional().describe('Wrap width in px (default 84% of the frame width).'),
    wrap: z
      .enum(['greedy', 'balanced'])
      .optional()
      .describe(
        'Line breaking (default greedy: fill each line). balanced keeps the line count but evens line widths and ' +
          'avoids ending a line on an article or preposition.'
      ),
    lineHeight: z.number().min(0.6).max(3).optional().describe('Line spacing as a multiple of size (default 1.05).'),
    effect: TextEffectSchema.optional().describe('Drop shadow / outline for legibility over footage.'),
    caret: z.boolean().optional().describe('typewriter: draw a blinking caret (default true).'),
    amplitude: z.number().min(0).max(200).optional().describe('wave: bob height in px (default 6% of size).'),
    frequency: z.number().min(0.1).max(8).optional().describe('wave: bobs per second (default 1.2).'),
    charset: z
      .string()
      .min(2)
      .max(120)
      .optional()
      .describe('scramble: characters to decode from (default A-Z0-9 and #%&*).'),
    counter: CounterSchema.optional(),
    trail: z
      .object({
        echoes: z.number().int().min(2).max(6).describe('Ghost copies drawn behind each moving unit (2..6).'),
        delta: z
          .number()
          .min(0.01)
          .max(0.25)
          .optional()
          .describe('Seconds each echo lags the one before it (default 0.04).'),
        fade: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe('Opacity of the first echo; each further echo multiplies it again (default 0.5).'),
      })
      .strict()
      .optional()
      .describe(
        'Echo trail (motion smear): each unit leaves fading copies of itself a few frames behind while it travels; the echoes collapse into it once it rests. Not applied to counter.'
      ),
    exit: z
      .union([z.enum(KINETIC_EXIT_PRESETS), KineticExitSchema])
      .optional()
      .describe('How the block leaves: a preset name or an object (default none: holds to the cut).'),
  })
  .strict()
  .describe('Kinetic typography block: per-word / per-glyph choreography, laid out and wrapped automatically.')
  .meta({ id: 'KineticBlock' });

export const KineticBlocksSchema = z
  .array(KineticBlockSchema)
  .max(8)
  .describe('Kinetic typography blocks: animated copy drawn on top of the section.');

export type KineticBlock = z.infer<typeof KineticBlockSchema>;
export type KineticExit = z.infer<typeof KineticExitSchema>;
export type KineticFill = z.infer<typeof KineticFillSchema>;
