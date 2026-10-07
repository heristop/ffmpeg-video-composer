import { z } from 'zod';
import { EasingSpecSchema, MotionRoleSchema } from './motion.schemas';
import { ElementIdSchema, timeValue } from './time.schemas';
import { TranslationSchema } from './global.schemas';
import { FxGraphicSchema } from './fx.schemas';
import { cornerStrokeFields, frameStrokeFields, underlineStrokeFields } from './graphics-stroke.schemas';

// ── animated graphics (docs/plans/motion-system.md §4.4) ──────────────────────
//
// Editorial shapes and light hits that animate in on a curve: flash, bars, underline, frame, corners,
// wipe, panel; pixel effects (glitch, focus) and data / broadcast graphics (progress, ticker,
// bars-chart). FFmpeg evaluates drawbox geometry once per filter, so each animated frame is its own box
// behind an `enable` window: frame-exact, deterministic, and on every backend.

const timing = {
  id: ElementIdSchema.optional(),
  at: timeValue(z.number().min(0))
    .optional()
    .describe('When it animates in: seconds from the section start (default 0) or a time reference ("beat:8").'),
  duration: z.number().positive().max(3).optional().describe('Seconds the animation takes (default per type).'),
  ease: EasingSpecSchema.optional().describe('Curve of the animation (default per type, e.g. $expo).'),
  role: MotionRoleSchema.optional(),
  until: timeValue(z.number().min(0))
    .optional()
    .describe('When it disappears: seconds or a time reference ("end - 0.3"); default: holds to the cut.'),
  color: z.string().optional().describe('Colour, "#rrggbb" or "#rrggbb@alpha" (default per type).'),
  above: z
    .boolean()
    .optional()
    .describe('Draw above text (default: true for flash, wipe, glitch, focus and underline; false otherwise).'),
};

const placement = {
  x: z.number().optional().describe('Left edge in px.'),
  y: z.number().optional().describe('Top edge in px.'),
  width: z.number().positive().optional().describe('Width in px.'),
};

export const GraphicSchema = z
  .discriminatedUnion('type', [
    z
      .object({
        type: z.literal('flash'),
        ...timing,
        intensity: z.number().min(0).max(1).optional().describe('Peak opacity (default 0.85).'),
      })
      .strict()
      .describe('A full-frame light hit that decays (default white, 0.3 s). Pair with a camera hit.'),
    z
      .object({
        type: z.literal('bars'),
        ...timing,
        aspect: z.number().min(1).max(4).optional().describe('Cinema aspect the bars frame (default 2.39).'),
      })
      .strict()
      .describe('Letterbox bars that slide in from the top and bottom edges.'),
    z
      .object({
        type: z.literal('underline'),
        ...timing,
        ...placement,
        thickness: z.number().positive().max(80).optional().describe('Line thickness in px (default 6).'),
        origin: z.enum(['left', 'center', 'right']).optional().describe('Where the line grows from (default left).'),
        ...underlineStrokeFields,
      })
      .strict()
      .describe(
        'A rule that draws itself across under a headline: round caps, an expo draw-on that settles, a fade exit, and drawn above text by default so a CTA card or ' +
          'plate under it never hides it.'
      ),
    z
      .object({
        type: z.literal('frame'),
        ...timing,
        inset: z
          .number()
          .min(0)
          .optional()
          .describe('Distance from the frame edge in px (default 48; ignored with a target).'),
        thickness: z.number().positive().max(40).optional().describe('Stroke in px (default 4).'),
        ...frameStrokeFields,
      })
      .strict()
      .describe(
        'A rectangle outline that traces itself clockwise: optional rounded corners, a constant-speed trace from the top-left with a head ' +
          'fade, a visible exit and contrast-aware colour.'
      ),
    z
      .object({
        type: z.literal('corners'),
        ...timing,
        inset: z
          .number()
          .min(0)
          .optional()
          .describe('Distance from the frame edge in px (default 56; ignored with a target).'),
        length: z
          .number()
          .positive()
          .optional()
          .describe('Arm length in px (default 72; with a target ~18% of its short side, 24..160).'),
        thickness: z.number().positive().max(40).optional().describe('Stroke in px (default 4).'),
        ...cornerStrokeFields,
      })
      .strict()
      .describe(
        'Four corner brackets that extend from the corners (viewfinder / focus framing): brackets around a subject that close ' +
          'in on a spring, extend clockwise from the top-left, exit by expanding and fading, and stay readable on ' +
          'light backgrounds.'
      ),
    z
      .object({
        type: z.literal('wipe'),
        ...timing,
        direction: z.enum(['left', 'right', 'up', 'down']).optional().describe('Travel direction (default left).'),
      })
      .strict()
      .describe(
        'A solid colour panel that sweeps across the whole frame: covers, then uncovers (an in-scene transition).'
      ),
    z
      .object({
        type: z.literal('panel'),
        ...timing,
        ...placement,
        height: z.number().positive().optional().describe('Height in px.'),
        from: z
          .enum(['left', 'right', 'top', 'bottom'])
          .optional()
          .describe('Edge the panel grows from (default left).'),
      })
      .strict()
      .describe('A solid block that grows from one edge: a backing plate for text or a colour reveal.'),
    z
      .object({
        type: z.literal('glitch'),
        ...timing,
        intensity: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe('How hard the frame tears: channel split, jitter and grain (default 0.6).'),
      })
      .strict()
      .describe(
        'A digital glitch hit: seeded RGB channel split, horizontal jitter, grain and colour slices for `duration` (default 0.35 s). Changes with global.seed.'
      ),
    z
      .object({
        type: z.literal('focus'),
        ...timing,
        direction: z
          .enum(['in', 'out'])
          .optional()
          .describe('in: blurred → sharp (rack focus in, default); out: sharp → blurred.'),
        amount: z.number().min(1).max(80).optional().describe('Peak gaussian blur radius in px (default 24).'),
      })
      .strict()
      .describe(
        'A rack focus: the frame blurs into or out of focus over `duration` (default 0.8 s). above: false keeps text drawn later sharp.'
      ),
    z
      .object({
        type: z.literal('progress'),
        ...timing,
        duration: z
          .number()
          .positive()
          .max(600)
          .optional()
          .describe('Seconds the bar takes to fill (default 3; linear unless `ease` is set).'),
        position: z.enum(['top', 'bottom']).optional().describe('Frame edge the bar sits on (default bottom).'),
        thickness: z.number().positive().max(80).optional().describe('Bar thickness in px (default 8).'),
        track: z.string().optional().describe('Colour of the unfilled track (default none), e.g. "#FFFFFF@0.2".'),
        ...placement,
        width: z.number().positive().optional().describe('Bar length in px (default full frame width).'),
      })
      .strict()
      .describe('A progress bar that fills left to right over `duration`, then holds full.'),
    z
      .object({
        type: z.literal('ticker'),
        ...timing,
        text: TranslationSchema.describe('The scrolling copy, per locale. {{ variables }} resolve first.'),
        speed: z.number().positive().max(2000).optional().describe('Scroll speed in px per second (default 160).'),
        position: z.enum(['top', 'bottom']).optional().describe('Frame edge the band sits on (default bottom).'),
        height: z.number().positive().max(400).optional().describe('Band height in px (default 7% of the frame).'),
        font: z.string().optional().describe('Bundled font id or .ttf file (default bebas).'),
        size: z.number().positive().max(300).optional().describe('Font size in px (default 60% of the band).'),
        textColor: z.string().optional().describe('Text colour (default #F5F3F7).'),
      })
      .strict()
      .describe(
        'A news ticker: a colour band grows in over `duration` (default 0.4 s), then the copy scrolls right to left and loops.'
      ),
    z
      .object({
        type: z.literal('bars-chart'),
        ...timing,
        values: z.array(z.number().min(0)).min(1).max(12).describe('Bar values (non-negative), left to right.'),
        labels: z.array(z.string().max(24)).max(12).optional().describe('Category label under each bar.'),
        max: z.number().positive().optional().describe('Value of a full-height bar (default: the largest value).'),
        ...placement,
        height: z.number().positive().optional().describe('Chart height in px (default 45% of the frame).'),
        stagger: z.number().min(0).max(1).optional().describe('Seconds between bars starting to grow (default 0.08).'),
        gap: z.number().min(0).max(0.9).optional().describe('Gap between bars as a fraction of a slot (default 0.3).'),
        showValues: z.boolean().optional().describe('Roll a value label above each bar (default true).'),
        decimals: z.number().int().min(0).max(4).optional().describe('Digits after the point in value labels.'),
        prefix: z.string().max(12).optional().describe('Text before each value, e.g. "$".'),
        suffix: z.string().max(12).optional().describe('Text after each value, e.g. "%".'),
        font: z.string().optional().describe('Bundled font id or .ttf file for labels (default bebas).'),
        textColor: z.string().optional().describe('Label colour (default #F5F3F7).'),
      })
      .strict()
      .describe(
        'An animated bar chart: bars grow from the baseline one after another on the curve while their values count up. `duration` is per bar (default 0.7 s).'
      ),
    FxGraphicSchema,
  ])
  .meta({ id: 'Graphic' });

export const GraphicsSchema = z
  .array(GraphicSchema)
  .max(24)
  .describe(
    'Animated graphics: flash, bars, underline, frame, corners, wipe, panel, glitch, focus, progress, ticker, ' +
      'bars-chart, and fx (procedural light primitives such as sheen: clipped to a target, tuned by parameters).'
  );

export type Graphic = z.infer<typeof GraphicSchema>;
