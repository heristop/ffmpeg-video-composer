// Editor transition shapes: the one after a visual section (section.transition) and the template
// default (global.transition). Split out of model.ts for its line budget.
import { DEFAULT_TRANSITION_DURATION } from 'ffmpeg-video-composer/src/schemas/effects.schemas.ts';
import type { MotionEase } from './motion-passthrough';

// A transition emitted after a visual section (maps to section.transition).
export interface SectionTransition {
  type: string;
  duration?: number;
  // Curve of a designed transition, passed through in descriptor shape.
  ease?: MotionEase;
}

// Default cross-section transition (maps to global.transition).
export interface DefaultTransition {
  type: string;
  duration: number;
  ease?: MotionEase;
}

// The duration mirrors the ENGINE fallback (DEFAULT_TRANSITION_DURATION) so a descriptor that
// leaves the duration unset re-hydrates — and re-emits — exactly what the engine renders.
export const DEFAULT_TRANSITION: DefaultTransition = { type: 'cut', duration: DEFAULT_TRANSITION_DURATION };
