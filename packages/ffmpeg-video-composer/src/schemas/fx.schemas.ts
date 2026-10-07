import { z } from 'zod';
import { EasingSpecSchema, MotionRoleSchema } from './motion.schemas';
import { ElementIdSchema, timeValue } from './time.schemas';
import { FX_PRIMITIVES, type FxEffectName } from './fx-primitives.schemas';

export {
  FX_PRIMITIVES,
  type FxDefaults,
  type FxDoc,
  type FxEffectName,
  type FxIntent,
  type FxPrimitive,
} from './fx-primitives.schemas';

// ── fx targets (editor/presets/fx-target.ts) ─────────────────────────────────────
//
// Procedural effects live INSIDE the element they decorate: a target names that element, the effect
// derives its geometry from it (so one descriptor adapts to landscape, portrait and square) and its light
// is clipped to the target's shape. Targets resolve at compile time to an even-pixel rectangle.

const FRACTION = /^(iw|ih)\s*\*\s*(\d*\.?\d+)$/;

const DimensionSchema = z
  .union([
    z.number(),
    z.string().regex(FRACTION, 'a number of px, or a fraction of the frame: "iw*0.5" (width) / "ih*0.25" (height)'),
  ])
  .describe('Pixels, or a fraction of the output frame: "iw*0.5" (of the width), "ih*0.25" (of the height).');

export const FxRectTargetSchema = z
  .object({
    x: DimensionSchema.describe('Left edge: px or "iw*f" / "ih*f".'),
    y: DimensionSchema.describe('Top edge: px or "iw*f" / "ih*f".'),
    w: DimensionSchema.describe('Width: px or "iw*f" / "ih*f".'),
    h: DimensionSchema.describe('Height: px or "iw*f" / "ih*f".'),
    radius: z
      .number()
      .min(0)
      .max(2000)
      .optional()
      .describe('Corner radius in px (default 0); the effect is clipped to the rounded shape.'),
  })
  .strict()
  .describe('An explicit rectangle, e.g. the card or the video a light should live on.');

export const FX_TARGET_REF = /^(pane|layer|text):(\d+)$/;

export const FxTargetSchema = z
  .union([
    z.literal('frame'),
    z.string().regex(FX_TARGET_REF, 'use "frame", "pane:<i>", "layer:<i>", "text:<i>" or a {x,y,w,h,radius} rectangle'),
    FxRectTargetSchema,
  ])
  .describe(
    'What the effect lives on; it never draws outside it. "frame": the whole frame (default). "pane:<i>": ' +
      'pane i of the section layout (split screen). "layer:<i>": options.layers[i] of a color_background. ' +
      '"text:<i>": kinetic block i, clipped to its letters. {x, y, w, h, radius}: a rectangle in px or ' +
      'frame fractions ("iw*0.5"), with rounded corners. Snapped inward to even pixels and clamped to the frame.'
  )
  .meta({ id: 'FxTarget' });

export type FxRectTarget = z.infer<typeof FxRectTargetSchema>;
export type FxTarget = z.infer<typeof FxTargetSchema>;

// ── the fx graphic: one primitive (fx-primitives.schemas.ts) plus the fields every primitive shares ──

const FX_COMMON = {
  id: ElementIdSchema.optional(),
  target: FxTargetSchema.optional(),
  at: timeValue(z.number().min(0))
    .optional()
    .describe('When the effect starts: seconds from the section start (default 0) or a time reference.'),
  duration: z
    .number()
    .min(0.1)
    .max(30)
    .optional()
    .describe(
      'Seconds one pass takes (default per primitive, quicker at higher global.motion.energy). A surface or an ' +
        'ambient texture lasts its duration: set it to the section length to hold it (up to 30).'
    ),
  ease: EasingSpecSchema.optional().describe(
    'Curve of one pass: a token ($smooth, $expo…), a named curve, cubic-bezier(…) or spring(…). Default per primitive.'
  ),
  role: MotionRoleSchema.optional(),
  until: timeValue(z.number().min(0)).optional().describe('Hard stop: nothing of the effect draws after this.'),
  repeat: z.number().int().min(1).max(8).optional().describe('Number of passes (default 1).'),
  every: z
    .number()
    .min(0.2)
    .max(30)
    .optional()
    .describe('Seconds from one pass start to the next when repeat > 1 (default: duration + 1.2).'),
  color: z
    .string()
    .optional()
    .describe(
      'Light colour: "#rrggbb", a colour name or a theme token ("$color.accent"). Default: a warm white tinted ' +
        "by the theme's accent. Its @alpha is ignored: use intensity."
    ),
  intensity: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      "Strength 0..1, mapped under the primitive's light ceiling (a sheen peaks at 0.35 alpha at 1; default ~0.9). " +
        'Keep ≤ 0.6 over skin.'
    ),
  seed: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      'Variation seed mixed with global.seed: picks the context defaults (tilt, width jitter) and the dither. ' +
        'Change it to re-roll an untuned effect; same seed, same pixels.'
    ),
  above: z.boolean().optional().describe('Draw above the section text (default: true on a text target, else false).'),
};

/** The shared fields' descriptions, for the motion catalog. */
export function fxSharedFields(): Record<string, string> {
  return Object.fromEntries(Object.entries(FX_COMMON).map(([key, schema]) => [key, schema.description ?? '']));
}

function fxObject<N extends FxEffectName>(effect: N) {
  const primitive = FX_PRIMITIVES[effect];

  // Described by describeFxPrimitives (fx-docs.ts): its summary and tuning note, like every field of the row.
  return z.object({ type: z.literal('fx'), effect: z.literal(effect), ...FX_COMMON, ...primitive.params }).strict();
}

type FxObject = ReturnType<typeof fxObject<FxEffectName>>;

export const FX_EFFECT_NAMES = Object.keys(FX_PRIMITIVES) as [FxEffectName, ...FxEffectName[]];

export const FxGraphicSchema = z
  .discriminatedUnion('effect', FX_EFFECT_NAMES.map(fxObject) as unknown as [FxObject, ...FxObject[]])
  .describe(
    'A procedural light/texture primitive lowered at output resolution and clipped to its `target`. Every look ' +
      'parameter is open: tune profile, size, angle, path, colour, intensity, timing and seed so the effect ' +
      'fits this template instead of a stock look. Omitted fields derive from the target, theme and energy.'
  );

export type FxGraphic = z.infer<typeof FxGraphicSchema>;
// One primitive's own fields (indexing the rows with a generic N in fxObject would merge them all).
type FxParamsOf<N extends FxEffectName> = N extends FxEffectName
  ? (typeof FX_PRIMITIVES)[N]['params'] extends infer P extends z.ZodRawShape
    ? z.infer<z.ZodObject<P>>
    : never
  : never;

/** The fx graphic of one primitive, with its own fields typed. */
export type FxGraphicOf<N extends FxEffectName> = N extends FxEffectName
  ? { type: 'fx'; effect: N } & z.infer<z.ZodObject<typeof FX_COMMON>> & FxParamsOf<N>
  : never;
