import { z } from 'zod';
import { MATTE_SHAPES } from '../core/motion/transition-names';

// The per-type fields of the designed transitions that draw shapes and bands (iris `shape`, zoom-through
// `through`, bands `count` / `angle` / `colors` / `stagger`), spread into TransitionSchema. Split out of
// effects.schemas.ts for its line budget.

const ThroughTextSchema = z
  .object({
    text: z.string().min(1).max(40).describe('The word the window is cut from, e.g. "ZOOM".'),
    glyph: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('0-based index of the character whose counter is the window (default the first with one).'),
    font: z
      .string()
      .optional()
      .describe('Bundled font id or .ttf file, as the kinetic block draws it (default bebas).'),
    size: z.number().positive().max(600).optional().describe('Font size in px (default 11% of the frame height).'),
    x: z.number().optional().describe('Anchor x in px, centre of the line, as a kinetic block (default frame centre).'),
    y: z
      .union([z.number(), z.enum(['top', 'center', 'bottom'])])
      .optional()
      .describe('Top of the line in px, or top / center / bottom, as a kinetic block (default center).'),
  })
  .strict()
  .describe(
    "A letter's counter (the hole of an O, the bowl of a P) laid out exactly as a kinetic block with the same " +
      'text, font, size, x and y: give the transition the values of the block the outgoing scene shows.'
  );

const ThroughShapeSchema = z
  .object({
    shape: z.enum(MATTE_SHAPES).describe('The window: circle, star, heart or rounded-square.'),
    size: z.number().positive().max(4000).describe('Width of the window in px.'),
    x: z.number().optional().describe('Centre x in px (default frame centre).'),
    y: z.number().optional().describe('Centre y in px (default frame centre).'),
  })
  .strict()
  .describe('A shaped window at a size and place.');

/** A transition paint: "#rrggbb" (optional @alpha) or a "$color.<name>" theme token, so a typo fails validation. */
export const TransitionColorSchema = z
  .string()
  .regex(
    /^(#[0-9a-fA-F]{6}|\$color\.[a-zA-Z][a-zA-Z0-9]*)(@[0-9.]+)?$/,
    'a "#rrggbb" colour or a "$color.<name>" theme token'
  );

export const TRANSITION_DESIGN_FIELDS = {
  shape: z
    .enum(MATTE_SHAPES)
    .optional()
    .describe(
      'iris: the shape that opens (default circle); star, heart and rounded-square open from origin and ignore rim.'
    ),
  through: z
    .union([ThroughTextSchema, ThroughShapeSchema])
    .optional()
    .describe(
      'zoom-through: fly into a window that shows the next scene, a letter counter ({ text, glyph, font, size, ' +
        'x, y }) or a shape ({ shape, size, x, y }); the window grows until it covers the frame.'
    ),
  count: z.number().int().min(2).max(8).optional().describe('bands: how many bands (default 4).'),
  angle: z
    .number()
    .min(-80)
    .max(80)
    .optional()
    .describe('bands: the bands’ angle in degrees, counter-clockwise from horizontal (default 30).'),
  colors: z
    .array(TransitionColorSchema)
    .min(1)
    .max(8)
    .optional()
    .describe('bands: band colours, cycled ("#rrggbb" or "$color.*"; default brand, accent, accent2, fg).'),
  stagger: z
    .number()
    .min(0)
    .max(0.5)
    .optional()
    .describe('bands: seconds between two bands (default 0.06, capped to fit the transition).'),
};

const TransitionDesignSchema = z.object(TRANSITION_DESIGN_FIELDS);

/** The shape / window / bands fields of a designed transition. */
export type TransitionDesign = z.infer<typeof TransitionDesignSchema>;
