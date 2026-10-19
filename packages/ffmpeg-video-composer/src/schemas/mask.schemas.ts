import { z } from 'zod';
import { ColorToken } from './color-token.schemas';
import { MAX_D, SVG_PATH } from './graphics-path.schemas';
import { LayerOriginSchema } from './layer-animate.schemas';
import { TrackSchema } from './motion.schemas';

// Masks and track mattes: `inputs[].options.mask` on image, animation and html layers, `options.mask` on video
// and project_video sections (lowered in editor/presets/mask-*.ts, layer-masks.ts and section-mask.ts). A mask
// has exactly one source: a `shape` (a rect with a corner radius, an ellipse, or an SVG path `d` limited to
// M/L/H/V/C/Q/Z and bounded like the path graphic's), drawn once at compile time into a grey image, or a
// `layer`, another layer of the same section read as a track matte (its alpha or its luma). Coordinates are
// output px. No field reads a file or the network.

export const MASK_MODES = ['alpha', 'luma'] as const;
export const MAX_MASK_FEATHER = 200;
/** A track matte names a layer by a plain identifier, so a name never reaches a pad label raw. */
export const MASK_LAYER_NAME = /^[A-Za-z0-9_-]{1,64}$/;

const MAX_PX = 20000;
const px = z.number().min(-MAX_PX).max(MAX_PX).describe('Output px.');
const extent = z.number().positive().max(MAX_PX).describe('Output px.');

export const MaskShapeSchema = z
  .discriminatedUnion('type', [
    z
      .object({
        type: z.literal('rect'),
        x: px,
        y: px,
        w: extent,
        h: extent,
        radius: z
          .number()
          .min(0)
          .max(MAX_PX)
          .optional()
          .describe('Corner radius in px, capped at half the shorter side (default 0).'),
      })
      .strict()
      .describe('A rectangle, optionally with rounded corners.'),
    z
      .object({ type: z.literal('ellipse'), cx: px, cy: px, rx: extent, ry: extent })
      .strict()
      .describe('An ellipse; rx = ry draws a circle.'),
    z
      .object({
        type: z.literal('path'),
        d: z
          .string()
          .max(MAX_D)
          .regex(SVG_PATH, 'an SVG path of M, L, H, V, C, Q and Z commands')
          .describe(
            `SVG path in output px (M, L, H, V, C, Q, Z, absolute or relative; at most ${MAX_D} characters). ` +
              'Each subpath is closed and filled (non-zero rule).'
          ),
      })
      .strict()
      .describe('Any closed outline: a star, a blob, a logo silhouette.'),
  ])
  .describe('The mask shape, in output px.')
  .meta({ id: 'MaskShape' });

/** The tracks of a shape mask's `animate`. */
export const MASK_TRACKS = ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotate'] as const;

export const MaskAnimateSchema = z
  .object({
    x: TrackSchema.optional().describe('Horizontal offset track in px from where the shape sits ("+80", "-40" or 80).'),
    y: TrackSchema.optional().describe('Vertical offset track in px from where the shape sits.'),
    scale: TrackSchema.optional().describe('Uniform scale track (0..10) about `origin`: 0 → 1.2 opens an iris.'),
    scaleX: TrackSchema.optional().describe('Horizontal scale track (0..10), multiplied with scale.'),
    scaleY: TrackSchema.optional().describe('Vertical scale track (0..10), multiplied with scale.'),
    rotate: TrackSchema.optional().describe('Rotation track in degrees, clockwise, about `origin`.'),
  })
  .strict()
  .describe('Keyframe tracks moving a shape mask, times in section seconds; each key eases into the next.');

const maskFields = {
  shape: MaskShapeSchema.optional(),
  layer: z
    .string()
    .regex(MASK_LAYER_NAME, 'a layer name of letters, digits, "_" and "-"')
    .optional()
    .describe(
      'Track matte: the name of another image, animation or html input of this section. That layer is not drawn; ' +
        'its position, timing and motion move the matte.'
    ),
  mode: z
    .enum(MASK_MODES)
    .optional()
    .describe('With layer: alpha (default, its opacity) or luma (its brightness: white shows, black hides).'),
  invert: z.boolean().optional().describe('Show outside the mask instead of inside.'),
  feather: z.number().min(0).max(MAX_MASK_FEATHER).optional().describe('Soft edge width in px (default 0).'),
  animate: MaskAnimateSchema.optional(),
  origin: LayerOriginSchema.optional().describe('The point of the shape its scale and rotate tracks pivot about.'),
};

type MaskFields = { shape?: unknown; layer?: unknown; mode?: unknown; animate?: unknown; origin?: unknown };

/** One source per mask; `mode` belongs to a track matte, `animate` / `origin` to a shape. */
export function maskIssues(mask: MaskFields, ctx: z.RefinementCtx): void {
  if ((mask.shape === undefined) === (mask.layer === undefined)) {
    ctx.addIssue({ code: 'custom', path: [], message: 'a mask takes exactly one of `shape` or `layer`' });
  }

  if (mask.layer === undefined && mask.mode !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['mode'], message: '`mode` belongs to a track matte (`layer`)' });
  }

  for (const key of ['animate', 'origin'] as const) {
    if (mask.shape === undefined && mask[key] !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `\`${key}\` moves a shape mask; a track matte follows its layer's own motion`,
      });
    }
  }
}

export const LayerMaskSchema = z
  .object(maskFields)
  .strict()
  .superRefine(maskIssues)
  .describe(
    'Show the layer only inside a shape or through another layer (track matte), with invert, feather and ' +
      'keyframed shape motion. Needs alphamerge: without it a shape falls back to its resting box and a track ' +
      'matte draws both layers (mask_unavailable).'
  )
  .meta({ id: 'LayerMask' });

export const SectionMaskSchema = z
  .object({
    ...maskFields,
    background: ColorToken.optional().describe(
      'Colour outside the mask: #RRGGBB, a name, $color.<token> or {{ VARIABLE }} (default black).'
    ),
  })
  .strict()
  .superRefine(maskIssues)
  .describe(
    "Show the clip only inside a shape or through one of the section's layers (track matte), `background` " +
      'outside. Layers and text draw on top, unmasked.'
  )
  .meta({ id: 'SectionMask' });

/** The `mask` option of video and project_video sections. */
export const SECTION_MASK_FIELDS = { mask: SectionMaskSchema.optional() };

export type MaskShape = z.infer<typeof MaskShapeSchema>;
export type MaskAnimate = z.infer<typeof MaskAnimateSchema>;
export type LayerMask = z.infer<typeof LayerMaskSchema>;
export type SectionMask = z.infer<typeof SectionMaskSchema>;
export type MaskMode = (typeof MASK_MODES)[number];
