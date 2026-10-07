import { z } from 'zod';

// ── fx primitives that mark a moment: ripple (a tap or a pulse), glint (star twinkles, orbiting specs)
// and confetti (a ballistic burst). Rows of FX_PRIMITIVES (fx-primitives.schemas.ts); lowered by
// editor/presets/fx-ripple.ts, fx-glint.ts and fx-confetti.ts. Every field is optional: an omitted one is
// derived from the target, the theme, global.motion.energy and the element's seed. Each row is checked
// against FxPrimitive where FX_PRIMITIVES lists it (no import back: that would be a cycle); its prose
// lives in fx-docs.ts.

const PointSchema = z
  .object({
    x: z.number().min(-0.5).max(1.5).describe('Across the target: 0 = left edge, 1 = right edge.'),
    y: z.number().min(-0.5).max(1.5).describe('Down the target: 0 = top edge, 1 = bottom edge.'),
  })
  .strict();

// An origin field, one instance per use: each carries its own description (fx-docs.ts).
function origin() {
  return PointSchema.optional();
}

export const ripple = {
  params: {
    variant: z.enum(['ring', 'tap']).optional(),
    origin: origin(),
    radius: z.number().min(0.1).max(3).optional(),
    rings: z.number().int().min(1).max(3).optional(),
    stagger: z.number().min(0).max(0.6).optional(),
    start: z.number().min(0.1).max(0.9).optional(),
    stroke: z.number().min(1).max(16).optional(),
    halo: z.number().min(0).max(24).optional(),
    dot: z.number().min(0.05).max(0.8).optional(),
    press: z.number().min(0).max(0.3).optional(),
  },
  defaults: { duration: 0.88, ease: 'cubic-bezier(0.16, 1, 0.3, 1)', ceiling: 0.85, intensity: 1 },
};

export const glint = {
  params: {
    path: z.enum(['scatter', 'corners', 'orbit']).optional(),
    points: z.array(PointSchema).min(1).max(6).optional(),
    count: z.number().int().min(1).max(6).optional(),
    size: z.number().min(8).max(96).optional(),
    stagger: z.number().min(0).max(0.4).optional(),
    spin: z.number().min(-90).max(90).optional(),
    trail: z.number().min(0).max(1).optional(),
    speed: z.number().min(0.2).max(3).optional(),
  },
  // Point sources: the peak is high (a star must read at 1080p) but each covers < 0.1 % of the frame.
  defaults: { duration: 0.9, ease: 'cubic-bezier(0.34, 1.56, 0.64, 1)', ceiling: 0.9, intensity: 0.85 },
};

export const confetti = {
  params: {
    count: z.number().int().min(4).max(36).optional(),
    origin: origin(),
    angle: z.number().min(-180).max(180).optional(),
    spread: z.number().min(0).max(360).optional(),
    speed: z.number().min(0.2).max(4).optional(),
    gravity: z.number().min(0).max(8).optional(),
    drag: z.number().min(0.1).max(8).optional(),
    sway: z.number().min(0).max(0.1).optional(),
    spin: z.number().min(0).max(4).optional(),
    size: z.number().min(4).max(64).optional(),
    discs: z.number().min(0).max(1).optional(),
    colors: z.array(z.string()).min(1).max(5).optional(),
    depth: z.number().min(0).max(1).optional(),
    fade: z.number().min(0.1).max(2).optional(),
  },
  defaults: { duration: 2.2, ease: 'linear', ceiling: 1, intensity: 1 },
};
