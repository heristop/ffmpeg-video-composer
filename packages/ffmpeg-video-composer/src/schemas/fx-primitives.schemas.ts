import { z } from 'zod';
import { confetti, glint, ripple } from './fx-celebrate.schemas';
import { bokeh, dust } from './fx-particles.schemas';
import { glass, resolve } from './fx-surface.schemas';
import { BLOOM, GRAIN, VIGNETTE_BREATHE } from './fx-ambient.schemas';
import { EDGE_GLOW, LEAK } from './fx-light.schemas';

// ── fx primitives: the parameter surface of every procedural effect ─────────────
//
// An fx effect is a PRIMITIVE with parameters, not a canned look: every field that defines how it looks
// (profile, width, angle, path, colour, intensity, timing, repetition, seed) is exposed and validated
// here, and an omitted field gets a default derived from the context (target size, theme accent, motion
// energy, the element's seed), so two templates using the same primitive do not look alike unless they
// ask to. One row per primitive: its own fields (merged with the shared fx fields in fx.schemas.ts) and
// its defaults. The prose — what each field does and the design intent the motion catalog shows to
// authors — lives in a matching row of fx-docs.ts, attached to these schemas only where it is read (the
// JSON schema, the motion catalog), so the browser's synchronous validation never loads it. The lowering
// lives in editor/presets/fx-<name>.ts.

export interface FxIntent {
  /** What the primitive is, in one line. */
  summary: string;
  /** When it earns its place. */
  useWhen: string;
  /** When to leave it out. */
  avoidWhen: string;
  /** Which parameters make it yours: what to vary and in which direction. */
  vary: string;
  /** What reduced motion (global.motion.energy 0) turns it into; starts with "absent" when it draws nothing. */
  reduced: string;
}

export interface FxDefaults {
  /** Seconds one pass takes at global.motion.energy 1 (scaled by 1/√energy, energy clamped to 0.5–2). */
  duration: number;
  ease: string;
  /** Doctrine ceiling: the peak alpha at intensity 1. */
  ceiling: number;
  /** Default intensity (0..1 of the ceiling). */
  intensity: number;
}

export interface FxPrimitive {
  /** Primitive-specific fields; every one optional, with a context-derived default. */
  params: z.ZodRawShape;
  defaults: FxDefaults;
}

/** A primitive's prose (a row of FX_DOCS, fx-docs.ts): what each of its fields does, and its design intent. */
export interface FxDoc<P extends z.ZodRawShape = z.ZodRawShape> {
  /** One description per field: its range, its default and what it changes. */
  params: { [K in keyof P]: string };
  intent: FxIntent;
}

const sheen = {
  params: {
    profile: z.enum(['specular', 'soft', 'twin']).optional(),
    width: z.number().min(0.02).max(0.6).optional(),
    tilt: z.number().min(-60).max(60).optional(),
    direction: z.enum(['right', 'left', 'down', 'up']).optional(),
    bloom: z.number().min(0).max(0.6).optional(),
  },
  // Peak alpha 0.32 by default: a glint, never a wash (doctrine: light ≤ 0.35).
  defaults: { duration: 0.75, ease: 'cubic-bezier(0.45, 0, 0.2, 1)', ceiling: 0.35, intensity: 0.32 / 0.35 },
} satisfies FxPrimitive;

/**
 * Every fx primitive, keyed by `effect`. Adding one: a row here (fields + defaults), its prose in FX_DOCS
 * (fx-docs.ts), its lowering module editor/presets/fx-<name>.ts and one line in the registry
 * (editor/presets/fx-registry.ts).
 */
export const FX_PRIMITIVES = {
  sheen,
  ripple,
  glint,
  confetti,
  bokeh,
  dust,
  glass,
  resolve,
  leak: LEAK,
  'edge-glow': EDGE_GLOW,
  bloom: BLOOM,
  'vignette-breathe': VIGNETTE_BREATHE,
  grain: GRAIN,
} as const satisfies Record<string, FxPrimitive>;

export type FxEffectName = keyof typeof FX_PRIMITIVES;
