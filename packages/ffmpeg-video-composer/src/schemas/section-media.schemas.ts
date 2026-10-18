import { z } from 'zod';
import { ColorToken } from './color-token.schemas';
import { OverlayFitSchema, OverlayFlipSchema, RevealSchema } from './effects.schemas';
import { FilterSchema } from './filter.schemas';
import { TranslationSchema } from './global.schemas';
import { HtmlInputShape, htmlInputIssues } from './html-input.schemas';
import { LayerAnimateSchema, LayerOriginSchema } from './layer-animate.schemas';
import { ClipBoxSchema } from './clip.schemas';
import { FilterExpressionPair } from './filter-expression.schemas';

// Input/shape/field media primitives — the animation input options, the editor-only shape recipe, the
// input schema and the form-field schema — live here to keep `section.schemas` under the max-lines
// budget; re-exported from `./section.schemas` so importers keep a single entry point.

// ── input ──────────────────────────────────────────────────────────────────────

export const InputOptionsSchema = z
  .object({
    fps: z.number().positive().optional().describe('Frames per second the animation plays at (default 25).'),
    position: FilterExpressionPair.optional().describe(
      'Overlay position as "x:y" in output pixels or FFmpeg expressions (e.g. "0:0" top-left).'
    ),
    scale: FilterExpressionPair.optional().describe(
      'Scale expression applied to the input before compositing, as "w:h".'
    ),
    fit: OverlayFitSchema.optional(),
    persistent: z
      .boolean()
      .optional()
      .describe('When true, freeze the last frame once the overlay ends (default false).'),
    loop: z.boolean().optional().describe('When true, loop continuously for the section/video (default false).'),
    loops: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Finite number of times the overlay plays. Takes precedence over loop; omit for loop/once.'),
    duration: z
      .number()
      .positive()
      .optional()
      .describe(
        'Seconds the overlay stays visible before it ends (animations loop the source to fill; still images hide). Precedence over loops/loop.'
      ),
    start: z.number().positive().optional().describe('Seconds to delay the overlay before it appears (default 0).'),
    opacity: z.number().min(0).max(1).optional().describe('Overlay alpha 0–1; 1 (or omitted) keeps it fully opaque.'),
    rotation: z.number().optional().describe('Clockwise rotation in degrees applied before compositing.'),
    flip: OverlayFlipSchema.optional(),
    motion: RevealSchema.optional().describe(
      'Animated entrance for the overlay: rise/slide in via overlay x/y expressions, or fade in.'
    ),
    animate: LayerAnimateSchema.optional(),
    origin: LayerOriginSchema.optional(),
    clip: ClipBoxSchema.optional().describe(
      'Cut the layer to a box (px) so it reveals from behind an invisible edge, e.g. sliding up out of a slot; ' +
        'works over footage.'
    ),
  })
  .strict()
  .describe('Playback and compositing options for an animation input.');

// Builder metadata for a shape element: the editor pre-rasterizes the shape into the input's PNG
// data: URL and keeps this vector recipe alongside so the shape controls re-hydrate on import. The
// ENGINE NEVER READS IT — the input composites exactly like any other still image — but the schema
// must carry it (zod's default strip mode would drop it on any parse-then-store flow).
export const ShapeSpecSchema = z
  .object({
    kind: z.enum(['rect', 'ellipse']).describe('Shape geometry: an axis-aligned rectangle or an ellipse/circle.'),
    color: ColorToken.describe('Fill colour as a hex string (e.g. "#ff4d4d").'),
    cornerRadius: z
      .number()
      .min(0)
      .optional()
      .describe('Rounded-corner radius in output pixels; rectangles only (0/omitted = square corners).'),
    strokeWidth: z
      .number()
      .min(0)
      .optional()
      .describe('Outline width in output pixels drawn inside the shape bounds (0/omitted = no outline).'),
    strokeColor: ColorToken.optional().describe('Outline colour as a hex string; used when strokeWidth > 0.'),
  })
  .strict()
  .describe('Editor-only recipe of a pre-rasterized shape overlay; ignored by the engine at compile.');

export const InputSchema = z
  .object({
    name: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/, 'An input name is a pad label: letters, digits, "_" or "-"')
      .describe('Unique identifier for this input within the section, used as a stream label in maps.'),
    url: z
      .string()
      .optional()
      .describe('URL or file path of the input asset; may use {{ varName }} template variables.'),
    type: z
      .enum(['animation', 'image', 'html'])
      .optional()
      .describe(
        '"animation" = animated overlay (.apng/.webp/.gif/.webm); "image" = still held for section duration; ' +
          '"html" = HTML/CSS layout rendered to a still (html, css, width, height).'
      ),
    shape: ShapeSpecSchema.optional().describe(
      'Editor-only shape recipe when this image input is a builder-rasterized shape; ignored by the engine.'
    ),
    ...HtmlInputShape,
    options: InputOptionsSchema.optional().describe('Playback and compositing options for this input.'),
    filters: z.array(FilterSchema).optional().describe('Filter chain applied to this input stream before compositing.'),
  })
  .superRefine(htmlInputIssues)
  .describe('An external asset (animation, still image or HTML layer) composited into the section video.');

// ── section options ────────────────────────────────────────────────────────────

export const FieldSchema = z
  .object({
    name: z.string().describe('Unique identifier for this form field, used as a variable name in filter templates.'),
    maxLength: z
      .number()
      .positive()
      .optional()
      .describe('Maximum number of characters; required unless the field binds a non-text global.fields entry.'),
    label: TranslationSchema.describe('Localised display label shown to the user for this field.'),
  })
  .describe('A single user-editable text field rendered in a form section.');
