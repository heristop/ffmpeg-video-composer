import { z } from 'zod';
import { TrackSchema } from './motion.schemas';

// ── fx "goo": liquid blobs that stretch, split into droplets and merge back. A row of FX_PRIMITIVES
// (fx-primitives.schemas.ts), lowered by editor/presets/fx-goo.ts; its prose lives in fx-liquid.docs.ts.
// Without `blobs` the effect choreographs one blob splitting into droplets and merging back from the seed;
// `blobs` places each blob and keyframes it with the layer tracks' `{ t, v, ease }` keys (section seconds).

const BlobAnimateSchema = z
  .object({
    x: TrackSchema.optional().describe('Centre x track, in target fractions (or "+0.1" relative to x).'),
    y: TrackSchema.optional().describe('Centre y track, in target fractions (or "-0.1" relative to y).'),
    r: TrackSchema.optional().describe("Radius track, a share of the target's short side (0 = gone)."),
  })
  .strict();

export const GooBlobSchema = z
  .object({
    x: z.number().min(-0.5).max(1.5).describe('Centre across the target: 0 = left edge, 1 = right edge.'),
    y: z.number().min(-0.5).max(1.5).describe('Centre down the target: 0 = top edge, 1 = bottom edge.'),
    r: z.number().min(0).max(0.6).describe("Radius as a share of the target's short side."),
    animate: BlobAnimateSchema.optional().describe(
      'Keyframe tracks (times in section seconds); each key eases into the next.'
    ),
  })
  .strict();

export const goo = {
  params: {
    blobs: z.array(GooBlobSchema).min(1).max(8).optional(),
    droplets: z.number().int().min(1).max(4).optional(),
    spread: z.number().min(0.05).max(0.5).optional(),
    angle: z.number().min(-180).max(180).optional(),
    size: z.number().min(0.04).max(0.4).optional(),
    goo: z.number().min(0).max(1).optional(),
    pop: z.boolean().optional(),
  },
  // A solid shape, not light: the ceiling is full opacity. The split's ease stretches out slowly, then overshoots once (~5 %): the droplets bounce apart.
  defaults: { duration: 2.6, ease: 'cubic-bezier(0.45, 0, 0.2, 1.3)', ceiling: 1, intensity: 1 },
};
