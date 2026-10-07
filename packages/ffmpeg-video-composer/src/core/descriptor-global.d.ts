// Whole-video overlay descriptor types (global.overlays, global.animations, global.watermark), split from
// types.d.ts for the max-lines budget and re-exported there.
import type { Reveal, TextEffect } from './descriptor-text';
import type { FontInput } from './fonts';
import type { OverlayFit, OverlayFlip, Translation } from './filter-types';

// A whole-video text overlay (global.overlays) composited onto every section (or a named subset).
export interface GlobalTextOverlay {
  text: Translation;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top' | 'bottom' | 'center';
  font?: FontInput;
  size?: number;
  color?: string;
  opacity?: number;
  reveal?: Reveal;
  effect?: TextEffect;
  sections?: string[];
}

// A whole-video animation overlay (global.animations) composited over the final joined video.
export interface GlobalAnimation {
  url: string;
  position?: string;
  scale?: string;
  /** Aspect handling within the "w:h" scale box; 'stretch' (or omitted) scales freely. */
  fit?: OverlayFit;
  opacity?: number;
  /** Clockwise rotation in degrees applied to the overlay before compositing. 0 (or omitted) = upright. */
  rotation?: number;
  /** Mirror the overlay before compositing: left-right, top-bottom, or both. */
  flip?: OverlayFlip;
  loop?: boolean;
  /** Finite play count; takes precedence over loop. */
  loops?: number;
  /** Seconds the overlay plays before it ends; takes precedence over loops/loop. */
  duration?: number;
  /** Seconds to delay the overlay before it appears (via -itsoffset); 0/omitted starts at the beginning. */
  start?: number;
  persistent?: boolean;
  /** Animated entrance (rise/slide/fade), same lowering as the per-section overlay path. */
  motion?: Reveal;
}

// The corner a `global.watermark` anchors to; also the position-lowering lookup key in
// editor/presets/watermark.ts (POSITION_EXPRESSIONS).
export type WatermarkPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

// A still-image watermark composited over the whole video (global.watermark) — pure sugar, lowered by
// watermarkToAnimation (editor/presets/watermark.ts) into a GlobalAnimation entry so it reuses the
// whole-video overlay pipeline untouched.
export interface Watermark {
  url: string;
  position?: WatermarkPosition;
  /** Watermark width as a fraction of the output width, 0.02..0.5 (default 0.12). */
  scale?: number;
  /** Watermark alpha, 0..1 (default 0.8). */
  opacity?: number;
  /** Inset from the frame edges in output pixels, 0..200 (default 24). */
  margin?: number;
}
