// packages/ffmpeg-video-composer/src/schemas/graphics-shape.schemas.ts
import { z } from 'zod';
import { ColorToken } from './color-token.schemas';
import { FxTargetSchema } from './fx.schemas';
import { MAX_D, pathGeometryError } from './graphics-path.schemas';
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
        points: z.number().int().min(3).max(24).optional().describe('Tips (5).'),
        inner: z.number().min(0.1).max(0.95).optional().describe('Inner/outer radius (0.5).'),
      })
      .strict(),
    z
      .object({
        type: z.literal('polygon'),
        sides: z.number().int().min(3).max(24).optional().describe('Sides (6).'),
      })
      .strict(),
    z.object({ type: z.literal('heart') }).strict(),
    z
      .object({
        type: z.literal('arrow'),
        direction: z.enum(['right', 'left', 'up', 'down']).optional().describe('Pointing (right).'),
        head: z.number().min(0.15).max(0.8).optional().describe('Head length share (0.4).'),
        shaft: z.number().min(0.1).max(0.9).optional().describe('Shaft thickness share (0.4).'),
      })
      .strict(),
    z
      .object({
        type: z.literal('blob'),
        lobes: z.number().int().min(3).max(12).optional().describe('Bumps (6).'),
        wobble: z.number().min(0).max(0.45).optional().describe('Inward dip (0.25).'),
        seed: z
          .number()
          .int()
          .min(0)
          .max(2 ** 31 - 1)
          .optional()
          .describe('Default: from global.seed.'),
      })
      .strict(),
    z
      .object({
        type: z.literal('rect'),
        radius: z.number().min(0).max(0.5).optional().describe('Corner radius share of the short side (0.15).'),
      })
      .strict(),
  ])
  .describe('Built-in outline in the box (rect radius 0.5: pill).');

export const ShapeGradientSchema = z
  .object({
    from: ColorToken,
    to: ColorToken,
    angle: z
      .number()
      .min(0)
      .max(360)
      .optional()
      .describe('Linear only: 0 bottom→top, 90 left→right, 180 top→bottom (180).'),
    shape: z.enum(['linear', 'radial']).optional().describe('linear (default) or radial (centre out).'),
  })
  .strict()
  .describe('Overrides `color`.');

export const ShapeStrokeSchema = z
  .object({
    color: ColorToken.optional(),
    width: z.number().positive().max(80).optional().describe('px (4).'),
    draw: z
      .boolean()
      .optional()
      .describe('Draw the outline on over `duration` (1.2 s), then fade the fill in; not with `animate`.'),
  })
  .strict();

export const shapeFields = {
  target: FxTargetSchema.optional().describe(
    'x, y, width, height (and `d` without viewBox) are fractions of this box.'
  ),
  d: z.string().max(MAX_D).optional().describe(`Closed SVG path of M L H V C Q Z, at most ${MAX_D} characters.`),
  viewBox: z
    .tuple([z.number(), z.number(), z.number().positive(), z.number().positive()])
    .optional()
    .describe('[minX, minY, w, h] of `d`: fits it into the box (icons).'),
  preset: ShapePresetSchema.optional(),
  x: z.number().min(-20000).max(20000).optional().describe('Box left, px (centred).'),
  y: z.number().min(-20000).max(20000).optional().describe('Box top, px (centred).'),
  width: z.number().positive().max(20000).optional().describe('Box width, px (40% of the short side; target: 1).'),
  height: z.number().positive().max(20000).optional().describe('Box height, px (= width).'),
  fill: z.boolean().optional().describe('false: outline only.'),
  gradient: ShapeGradientSchema.optional(),
  fillRule: z.enum(['nonzero', 'evenodd']).optional().describe('nonzero (default) or evenodd.'),
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
