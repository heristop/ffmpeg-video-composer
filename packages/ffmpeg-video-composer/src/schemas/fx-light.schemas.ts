import { z } from 'zod';

// ── fx light primitives that live AROUND or BESIDE their target: `leak` and `edge-glow` ──────────
//
// Rows of FX_PRIMITIVES (fx-primitives.schemas.ts holds the contract). Every look parameter is open and
// optional; an omitted one is derived from the target, the theme and the element's seed by the lowering
// (editor/presets/fx-leak.ts, fx-edge-glow.ts), so two templates never get the same leak or glow by default.

/** "#rrggbb" (after theme resolution) or a "$color.<name>" theme token; an @alpha suffix is ignored. */
export const FxColorSchema = z
  .string()
  .regex(/^(#[0-9a-fA-F]{6}|\$color\.[a-zA-Z]+)(@[0-9.]+)?$/, 'a "#rrggbb" colour or a "$color.<name>" theme token');

/** The `$smooth` curve, spelled out (defaults are applied after token resolution). */
export const SMOOTH = 'cubic-bezier(0.4, 0, 0.2, 1)';

const LEAK_EDGES = ['left', 'right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;

export const LEAK = {
  params: {
    edge: z.enum(LEAK_EDGES).optional(),
    size: z.number().min(0.2).max(1.5).optional(),
    stretch: z.number().min(0.5).max(3).optional(),
    drift: z.number().min(-0.3).max(0.3).optional(),
    secondary: FxColorSchema.optional(),
    balance: z.number().min(0).max(1).optional(),
    spread: z.number().min(0).max(1.5).optional(),
    shadows: z.number().min(0).max(1).optional(),
    rise: z.number().min(0.05).max(0.6).optional(),
    fall: z.number().min(0.1).max(0.8).optional(),
  },
  // Peak 0.22 at the brightest point by default (doctrine: leaks ≤ 0.25).
  defaults: { duration: 2.6, ease: SMOOTH, ceiling: 0.25, intensity: 0.88 },
};

export const EDGE_GLOW = {
  params: {
    line: z.number().min(0).max(1).optional(),
    lineWidth: z.number().min(0.5).max(8).optional(),
    spread: z.number().min(2).max(48).optional(),
    glow: FxColorSchema.optional(),
    breathe: z.number().min(0).max(0.25).optional(),
    period: z.number().min(1.5).max(12).optional(),
  },
  // Bloom peak 0.18 by default (intensity 0.18 / 0.35); the hairline has its own `line` opacity.
  defaults: { duration: 4, ease: SMOOTH, ceiling: 0.35, intensity: 0.18 / 0.35 },
};
