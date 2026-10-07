import { z } from 'zod';
import { SMOOTH } from './fx-light.schemas';

// ── fx ambient primitives: `bloom`, `vignette-breathe`, `grain` ─────────────────────────────────
//
// Rows of FX_PRIMITIVES (fx-primitives.schemas.ts holds the contract). Ambient textures sit under the
// doctrine's 0.12 ceiling, last as long as `duration` (or `until`) with a soft ramp at both ends, and are
// absent under reduced motion. Lowerings: editor/presets/fx-bloom.ts, fx-vignette.ts, fx-grain.ts.

export const BLOOM = {
  params: {
    threshold: z.number().min(0.3).max(0.98).optional(),
    knee: z.number().min(0.02).max(0.4).optional(),
    radius: z.number().min(0.002).max(0.06).optional(),
    ramp: z.number().min(0.13).max(2).optional(),
  },
  defaults: { duration: 6, ease: SMOOTH, ceiling: 0.12, intensity: 0.85 },
};

export const VIGNETTE_BREATHE = {
  params: {
    angle: z.number().min(0.15).max(1.2).optional(),
    swing: z.number().min(0).max(0.15).optional(),
    period: z.number().min(2).max(16).optional(),
    focus: z
      .object({
        x: z.number().min(0).max(1).describe('0..1 across the target (default ~0.5).'),
        y: z.number().min(0).max(1).describe('0..1 down the target (default ~0.45).'),
      })
      .strict()
      .optional(),
  },
  defaults: { duration: 6, ease: SMOOTH, ceiling: 0.12, intensity: 1 },
};

export const GRAIN = {
  params: {
    size: z.number().min(1).max(4).optional(),
    animated: z.boolean().optional(),
    ramp: z.number().min(0.13).max(2).optional(),
  },
  defaults: { duration: 6, ease: SMOOTH, ceiling: 0.12, intensity: 0.85 },
};
