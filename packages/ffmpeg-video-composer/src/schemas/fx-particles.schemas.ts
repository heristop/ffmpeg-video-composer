import { z } from 'zod';

// ── fx primitives "bokeh" and "dust": ambient particles (rows of FX_PRIMITIVES, fx-primitives.schemas.ts) ──
//
// Lowered by editor/presets/fx-particles.ts. Both are ambient textures: capped at 0.12 alpha, drifting
// slowly, and absent under reduced motion (global.motion.energy 0).

// Shared field shapes, one instance per use: each field carries its own description (fx-docs.ts).
function drift() {
  return z.number().min(-180).max(360).optional();
}

function clear() {
  return z.number().min(0).max(0.8).optional();
}

export const bokeh = {
  params: {
    count: z.number().int().min(2).max(16).optional(),
    size: z.number().min(0.02).max(0.3).optional(),
    softness: z.number().min(0).max(1).optional(),
    drift: drift(),
    speed: z.number().min(0).max(0.2).optional(),
    depth: z.number().min(0).max(1).optional(),
    clear: clear(),
  },
  // Ambient light: ≤ 0.12 alpha at the brightest disc (plan acceptance), 0.09 by default.
  defaults: { duration: 6, ease: 'linear', ceiling: 0.12, intensity: 0.75 },
};

export const dust = {
  params: {
    count: z.number().int().min(4).max(40).optional(),
    size: z.number().min(0.5).max(4).optional(),
    drift: drift(),
    speed: z.number().min(0).max(0.1).optional(),
    flicker: z.number().min(0).max(1).optional(),
    clear: clear(),
  },
  // Ambient texture: ≤ 0.12 alpha per mote (plan acceptance); motes are tiny, so they sit at the ceiling by default.
  defaults: { duration: 6, ease: 'linear', ceiling: 0.12, intensity: 1 },
};
