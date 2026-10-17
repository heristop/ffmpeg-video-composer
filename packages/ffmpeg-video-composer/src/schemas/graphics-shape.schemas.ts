// packages/ffmpeg-video-composer/src/schemas/graphics-shape.schemas.ts
import { z } from 'zod';
import { ColorToken } from './color-token.schemas';
import { FxTargetSchema } from './fx.schemas';
import { pathGeometryError } from './graphics-path.schemas';
import { LayerAnimateSchema, LayerOriginSchema } from './layer-animate.schemas';

// ── fields of the shape graphic: a filled, optionally stroked vector shape (editor/presets/shape-*.ts) ──
//
// The outline is exactly one of `preset` (star, polygon, heart, arrow, blob, rect, laid in the box
// x/y/width/height) or `d` (an SVG path limited to M/L/H/V/C/Q/Z, the path graphic's grammar and length cap).
// With a `viewBox`, `d` is mapped into the box keeping its proportions (an icon's "0 0 24 24"); without one,
// its coordinates are px, or fractions of `target` like the path graphic's. Rasterised once at compile time;
// `animate` moves it with the layer tracks (x, y, scale, scaleX, scaleY, rotate, opacity).

export const SHAPE_PRESET_TYPES = ['star', 'polygon', 'heart', 'arrow', 'blob', 'rect'] as const;

export const ShapePresetSchema = z
  .discriminatedUnion('type', [
    z
      .object({
        type: z.literal('star'),
        points: z.number().int().min(3).max(24).optional().describe('Tips (default 5).'),
        inner: z.number().min(0.1).max(0.95).optional().describe('Inner radius as a share of the outer (default 0.5).'),
      })
      .strict()
      .describe('A regular star, first tip up.'),
    z
      .object({
        type: z.literal('polygon'),
        sides: z.number().int().min(3).max(24).optional().describe('Sides (default 6).'),
      })
      .strict()
      .describe('A regular polygon, first corner up.'),
    z
      .object({ type: z.literal('heart') })
      .strict()
      .describe('A heart.'),
    z
      .object({
        type: z.literal('arrow'),
        direction: z.enum(['right', 'left', 'up', 'down']).optional().describe('Where it points (default right).'),
        head: z.number().min(0.15).max(0.8).optional().describe('Head length as a share of the arrow (default 0.4).'),
        shaft: z.number().min(0.1).max(0.9).optional().describe('Shaft thickness as a share of the box (default 0.4).'),
      })
      .strict()
      .describe('A block arrow filling the box.'),
    z
      .object({
        type: z.literal('blob'),
        lobes: z.number().int().min(3).max(12).optional().describe('Bumps around the outline (default 6).'),
        wobble: z.number().min(0).max(0.45).optional().describe('How far a bump dips inward, 0..0.45 (default 0.25).'),
        seed: z
          .number()
          .int()
          .min(0)
          .max(2 ** 31 - 1)
          .optional()
          .describe('Outline seed (default: derived from global.seed and the graphic path).'),
      })
      .strict()
      .describe('A smooth organic blob.'),
    z
      .object({
        type: z.literal('rect'),
        radius: z
          .number()
          .min(0)
          .max(0.5)
          .optional()
          .describe('Corner radius as a share of the short side (default 0.15).'),
      })
      .strict()
      .describe('A rounded rectangle filling the box (radius 0.5: a pill).'),
  ])
  .describe('A built-in outline laid in the box; star, polygon, heart and blob keep their proportions.');

export const ShapeGradientSchema = z
  .object({
    from: ColorToken.describe('Start colour.'),
    to: ColorToken.describe('End colour.'),
    angle: z
      .number()
      .min(0)
      .max(360)
      .optional()
      .describe('Linear only, CSS convention: 0 bottom→top, 90 left→right, 180 top→bottom (default 180).'),
    shape: z
      .enum(['linear', 'radial'])
      .optional()
      .describe('linear (default) or radial (from the centre out to the box edge).'),
  })
  .strict()
  .describe('Gradient fill across the shape box; overrides `color`.');

export const ShapeStrokeSchema = z
  .object({
    color: ColorToken.optional().describe('Outline colour (default #F5F3F7).'),
    width: z.number().positive().max(80).optional().describe('Outline width in px (default 4).'),
    draw: z
      .boolean()
      .optional()
      .describe('Draw the outline on over `duration` (default 1.2 s), then fade the fill in; not with `animate`.'),
  })
  .strict();

export const shapeFields = {
  target: FxTargetSchema.optional().describe(
    'x, y, width, height (and a `d` without viewBox) are fractions of this box.'
  ),
  d: z.string().optional().describe('Closed SVG path of M, L, H, V, C, Q, Z; open subpaths close for the fill.'),
  viewBox: z
    .tuple([z.number(), z.number(), z.number().positive(), z.number().positive()])
    .optional()
    .describe('[minX, minY, width, height] of `d`: maps it into the box keeping its proportions (icons).'),
  preset: ShapePresetSchema.optional(),
  x: z.number().min(-20000).max(20000).optional().describe('Left of the box in px (default: centred).'),
  y: z.number().min(-20000).max(20000).optional().describe('Top of the box in px (default: centred).'),
  width: z
    .number()
    .positive()
    .max(20000)
    .optional()
    .describe('Box width in px (default 40% of the short side; with a target, 1).'),
  height: z.number().positive().max(20000).optional().describe('Box height in px (default: as width).'),
  fill: z.boolean().optional().describe('false: outline only (needs a stroke).'),
  gradient: ShapeGradientSchema.optional(),
  fillRule: z
    .enum(['nonzero', 'evenodd'])
    .optional()
    .describe('nonzero (default) or evenodd (crossing loops leave holes).'),
  stroke: ShapeStrokeSchema.optional(),
  origin: LayerOriginSchema.optional(),
  animate: LayerAnimateSchema.optional(),
};

type ShapeInput = {
  d?: string;
  preset?: unknown;
  viewBox?: unknown;
  fill?: boolean;
  gradient?: unknown;
  stroke?: { draw?: boolean };
  animate?: unknown;
};

export interface ShapeIssue {
  message: string;
  path: string[];
}

function outlineIssue(g: ShapeInput): ShapeIssue | null {
  if ((g.d === undefined) === (g.preset === undefined)) {
    return { message: 'a shape needs exactly one of `d` or `preset`', path: [] };
  }

  const dError = g.d === undefined ? null : pathGeometryError({ d: g.d });

  if (dError) return { message: dError, path: ['d'] };

  if (g.viewBox !== undefined && g.d === undefined) {
    return { message: '`viewBox` maps a `d` into the box; a preset has no viewBox', path: ['viewBox'] };
  }

  return null;
}

function paintIssue(g: ShapeInput): ShapeIssue | null {
  if (g.fill === false && g.stroke === undefined) {
    return { message: 'a shape with fill: false needs a stroke', path: ['fill'] };
  }

  if (g.fill === false && g.gradient !== undefined) {
    return { message: '`gradient` fills the shape: drop fill: false', path: ['gradient'] };
  }

  if (g.stroke?.draw && g.animate !== undefined) {
    return { message: 'stroke.draw reveals the outline in place: drop animate or the draw', path: ['stroke', 'draw'] };
  }

  return null;
}

/** Null when the shape is coherent, else the first problem and the field it sits on. */
export function shapeGraphicError(g: ShapeInput): ShapeIssue | null {
  return outlineIssue(g) ?? paintIssue(g);
}
