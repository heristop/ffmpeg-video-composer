import { z } from 'zod';

// ── fx primitives "glass" and "resolve": they reshape the target's own pixels (rows of FX_PRIMITIVES) ──
//
// Lowered by editor/presets/fx-glass.ts and fx-resolve.ts, from a copy of the target region the fx kit
// hands them.

export const glass = {
  params: {
    tone: z.enum(['dark', 'light']).optional(),
    frost: z.number().min(0).max(0.3).optional(),
    saturation: z.number().min(0).max(1).optional(),
    highlight: z.number().min(0).max(1).optional(),
    ramp: z.number().min(0.1).max(1.5).optional(),
  },
  // intensity × ceiling = how far the glass is tinted toward `color` (default: a deep shade of the light colour
  // on dark glass, the light colour itself on light glass). `duration` is how long the card stays.
  defaults: { duration: 4, ease: 'linear', ceiling: 0.3, intensity: 0.5 },
};

export const resolve = {
  params: {
    blur: z.number().min(0).max(0.2).optional(),
    scale: z.number().min(1).max(1.2).optional(),
    fade: z.number().min(0.1).max(1).optional(),
  },
  // Not a light: intensity scales how far out of focus and how large it starts (the ceiling only bounds the row).
  defaults: { duration: 0.7, ease: 'cubic-bezier(0.16, 1, 0.3, 1)', ceiling: 0.35, intensity: 1 },
};
