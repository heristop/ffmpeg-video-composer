// Visual-grade / motion / background-layer descriptor types. Split out of `types.d.ts` to keep that
// file under the max-lines budget; re-exported from there so importers keep a single `@/core/types`
// entry point. Self-contained (primitives only — no import back into `types.d.ts`) so the module graph
// stays acyclic.

export interface ChannelAdjust {
  r?: number;
  g?: number;
  b?: number;
}

export interface GradeConfig {
  brightness?: number;
  contrast?: number;
  saturation?: number;
  gamma?: number;
  hue?: number;
  colorBalance?: {
    shadows?: ChannelAdjust;
    midtones?: ChannelAdjust;
    highlights?: ChannelAdjust;
  };
  blur?: number;
  grain?: number;
  curvesPreset?: string;
  /** User 3D .cube LUT, applied first (presets/lut-spec.ts). */
  lut?: { url: string; strength?: number };
}

export interface Letterbox {
  aspect: number;
  color?: string;
}

export type MotionEffect =
  | { type: 'kenburns'; direction?: 'in' | 'out' | 'left' | 'right' | 'up' | 'down'; intensity?: number }
  | { type: 'rotate'; angle: number }
  | { type: 'crop'; w: number | string; h: number | string; x?: number | string; y?: number | string }
  | { type: 'flip'; axis: 'horizontal' | 'vertical' }
  | { type: 'shake'; intensity?: number; frequency?: number }
  | { type: 'pulse'; intensity?: number; frequency?: number };

export interface BackgroundLayer {
  color?: string;
  opacity?: number;
  x?: number | string;
  y?: number | string;
  w?: number | string;
  h?: number | string;
  gradient?: { from: string; to: string; direction?: 'horizontal' | 'vertical' | 'diagonal'; angle?: number };
}
