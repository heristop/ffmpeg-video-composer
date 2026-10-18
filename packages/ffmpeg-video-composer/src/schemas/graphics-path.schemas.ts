import { z } from 'zod';
import { ColorToken } from './color-token.schemas';
import { FxTargetSchema } from './fx.schemas';

// ── fields of the path graphic: a stroke that draws itself along any path (editor/presets/path-*.ts) ──
//
// The geometry is exactly one of `points` (a polyline, optionally smoothed), `shape` (circle, ellipse, arc,
// wave) or `d` (an SVG path limited to M/L/H/V/C/Q/Z). Coordinates are px, or fractions (0..1) of `target`
// when it is set ("frame" = fractions of the frame).

export const PATH_EXITS = ['none', 'fade', 'retract'] as const;
export const PATH_CAPS = ['round', 'butt'] as const;
/** SVG path commands the `d` field accepts (upper case absolute, lower case relative). */
const MAX_D = 4000;
export const SVG_PATH = /^[\s,]*[Mm][\s,MmLlHhVvCcQqZz\d.eE+-]*$/;

const coordinate = z.number();
const size = z.number().positive();
const angle = z.number();
const direction = z.enum(['cw', 'ccw']).optional();
const start = angle.optional().describe('Start angle, degrees clockwise from 3 o’clock (default -90: 12 o’clock).');

export const PathShapeSchema = z.discriminatedUnion('type', [
  z
    .object({ type: z.literal('circle'), cx: coordinate, cy: coordinate, r: size, start, direction })
    .strict()
    .describe('With a target, r is a fraction of its shorter side.'),
  z
    .object({ type: z.literal('ellipse'), cx: coordinate, cy: coordinate, rx: size, ry: size, start, direction })
    .strict()
    .describe('An ellipse.'),
  z
    .object({
      type: z.literal('arc'),
      cx: coordinate,
      cy: coordinate,
      r: size,
      start,
      sweep: angle.describe('Degrees (< 0: ccw).'),
    })
    .strict()
    .describe('A circular arc.'),
  z
    .object({
      type: z.literal('wave'),
      x: coordinate,
      y: coordinate,
      width: size,
      amplitude: z.number().min(0),
      wavelength: size,
      phase: angle.optional().describe('Degrees (default 0: rising).'),
    })
    .strict()
    .describe('A sine wave, left to right.'),
]);

export const pathStrokeFields = {
  target: FxTargetSchema.optional().describe('Coordinates are 0..1 fractions of this box (default: px).'),
  points: z
    .array(z.tuple([coordinate, coordinate]))
    .min(2)
    .max(64)
    .optional()
    .describe('[x, y] pairs.'),
  smooth: z.boolean().optional().describe('A smooth curve through the points.'),
  closed: z.boolean().optional(),
  shape: PathShapeSchema.optional(),
  d: z.string().optional().describe('SVG path of M, L, H, V, C, Q, Z.'),
  thickness: z.number().positive().max(80).optional().describe('Line thickness in px (default 6).'),
  caps: z.enum(PATH_CAPS).optional().describe('round (default) or butt.'),
  dash: z.tuple([z.number().positive(), z.number().positive()]).optional().describe('[on, off] px.'),
  from: z.number().min(0).max(1).optional().describe('Start position, 0..1 (default 0).'),
  to: z.number().min(0).max(1).optional().describe('End position (default 1).'),
  head: z
    .union([
      z.boolean(),
      z
        .object({
          size: z.number().positive().max(200).optional(),
          color: ColorToken.optional(),
        })
        .strict(),
    ])
    .optional()
    .describe('A dot riding the drawing end.'),
  exit: z.enum(PATH_EXITS).optional().describe('fade (default), retract (erases in drawing order) or none.'),
  exitDuration: z.number().min(0.1).max(3).optional(),
};

type PathGeometry = { points?: unknown; shape?: unknown; d?: string };

/** Null when the path has exactly one geometry source and a supported `d`, else what is wrong. */
export function pathGeometryError(g: PathGeometry): string | null {
  if ([g.points, g.shape, g.d].filter((source) => source !== undefined).length !== 1) {
    return 'a path needs exactly one of `points`, `shape` or `d`';
  }

  if (g.d === undefined) return null;

  if (g.d.length > MAX_D) return `\`d\` is longer than ${MAX_D} characters`;

  return SVG_PATH.test(g.d) ? null : '`d` takes M, L, H, V, C, Q and Z commands only';
}
