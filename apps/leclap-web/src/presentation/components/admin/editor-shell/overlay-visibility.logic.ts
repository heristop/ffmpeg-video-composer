// Pure reveal/exit sampling for the live program monitor: given an overlay's entrance + exit and the
// scene's local clock, where is it right now? Timing defaults mirror RevealControl / ExitControl and
// the engine's reveal.schemas (delay 0.3 / duration 0.6 / distance 60; an exit with no `after` is
// timed to END exactly at the scene end).
import type { Reveal, Exit } from '../templateEditorModel';

export type OverlayPhase = 'before' | 'reveal' | 'hold' | 'exit' | 'after';

export interface OverlayVisibility {
  phase: OverlayPhase;
  progress: number; // 0..1 within reveal/exit; 1 during hold
  opacity: number;
  translateX: number; // px, applied on the animation wrapper (never the box's own centering)
  translateY: number;
}

export const REVEAL_DEFAULTS = { delay: 0.3, duration: 0.6, distance: 60 } as const;
export const EXIT_DEFAULTS = { duration: 0.6, distance: 60 } as const;

interface NormalizedReveal {
  type: string;
  delay: number;
  duration: number;
  distance: number;
  easing?: string;
}

interface NormalizedExit {
  type: string;
  easing?: string;
  after?: number;
  duration: number;
  distance: number;
}

// A Reveal is either a bare style name or an object with timing overrides — normalize to one shape.
function normalizeReveal(reveal: Reveal | undefined): NormalizedReveal | null {
  if (!reveal) return null;

  const obj = typeof reveal === 'string' ? { type: reveal } : reveal;

  if (obj.type === 'none') return null;

  return {
    type: obj.type,
    delay: typeof reveal === 'string' ? REVEAL_DEFAULTS.delay : (reveal.delay ?? REVEAL_DEFAULTS.delay),
    duration: typeof reveal === 'string' ? REVEAL_DEFAULTS.duration : (reveal.duration ?? REVEAL_DEFAULTS.duration),
    distance: typeof reveal === 'string' ? REVEAL_DEFAULTS.distance : (reveal.distance ?? REVEAL_DEFAULTS.distance),
    ...(typeof reveal === 'object' && reveal.easing !== undefined ? { easing: reveal.easing } : {}),
  };
}

function normalizeExit(exit: Exit | undefined): NormalizedExit | null {
  if (!exit) return null;

  const obj = typeof exit === 'string' ? { type: exit } : exit;

  if (obj.type === 'none') return null;

  return {
    type: obj.type,
    ...(typeof exit === 'object' && exit.after !== undefined ? { after: exit.after } : {}),
    duration: typeof exit === 'string' ? EXIT_DEFAULTS.duration : (exit.duration ?? EXIT_DEFAULTS.duration),
    ...(typeof exit === 'object' && exit.easing !== undefined ? { easing: exit.easing } : {}),
    distance: typeof exit === 'string' ? EXIT_DEFAULTS.distance : (exit.distance ?? EXIT_DEFAULTS.distance),
  };
}

// The app's signature ease-out-expo curve, sampled numerically (same feel as gradient-meter).
export function easeOutExpo(p: number): number {
  if (p <= 0) return 0;

  if (p >= 1) return 1;

  return 1 - Math.pow(2, -10 * p);
}

// Samples the AUTHORED easing at a 0..1 progress, mirroring the engine's expression curves
// (linear ramp / cubic-out 1-(1-p)^3 / smoothstep p*p*(3-2p)). An unset easing keeps the monitor's
// signature ease-out-expo feel, so pre-easing templates preview exactly as before.
function easeProgress(progress: number, easing: string | undefined): number {
  const p = Math.min(1, Math.max(0, progress));

  if (easing === 'linear') return p;

  if (easing === 'ease-out') return 1 - Math.pow(1 - p, 3);

  if (easing === 'ease-in-out') return p * p * (3 - 2 * p);

  if (easing === 'ease-out-back') return p * (1 + (p - 1) * (2.70158 * (p - 1) - 1));

  return easeOutExpo(p);
}

// Motion can overshoot its resting position; opacity remains bounded to 0..1. `entering` animates toward
// the resting state (offset → 0); exits animate away from it (0 → offset). `easing` is the reveal's
// authored curve. Unspecified entrance/exit easing uses ease-out-expo.
export function revealOffset(
  type: string,
  progress: number,
  distance: number,
  entering: boolean,
  easing?: string
): { opacity: number; translateX: number; translateY: number } {
  const eased = easeProgress(progress, easing);
  const remaining = entering ? 1 - eased : eased;
  const opacity = Math.min(1, Math.max(0, entering ? eased : 1 - eased));
  const direction = entering ? 1 : -1;

  if (type === 'fade') return { opacity, translateX: 0, translateY: 0 };

  if (type === 'rise') return { opacity, translateX: 0, translateY: direction * distance * remaining };

  if (type === 'slide-left') return { opacity, translateX: direction * distance * remaining, translateY: 0 };

  if (type === 'slide-right') return { opacity, translateX: -direction * distance * remaining, translateY: 0 };

  return { opacity: 1, translateX: 0, translateY: 0 };
}

const RESTING: OverlayVisibility = { phase: 'hold', progress: 1, opacity: 1, translateX: 0, translateY: 0 };

// Where an overlay sits at `localT` seconds into a `duration`-second scene. Overlays with neither a
// reveal nor an exit are always at rest (fully visible, unmoved).
export function overlayVisibilityAt(
  reveal: Reveal | undefined,
  exit: Exit | undefined,
  localT: number,
  duration: number
): OverlayVisibility {
  const entrance = normalizeReveal(reveal);
  const leave = normalizeExit(exit);

  if (entrance && localT < entrance.delay) {
    return { phase: 'before', progress: 0, opacity: 0, ...offsetAt(entrance, 0, true) };
  }

  if (entrance && localT < entrance.delay + entrance.duration) {
    const progress = (localT - entrance.delay) / entrance.duration;
    const sample = revealOffset(entrance.type, progress, entrance.distance, true, entrance.easing);

    return { phase: 'reveal', progress, ...sample };
  }

  if (!leave) return RESTING;

  // Exit window: starts at `after`, or timed to end exactly at the scene end when unset.
  const exitStart = leave.after ?? Math.max(0, duration - leave.duration);

  if (localT < exitStart) return RESTING;

  if (localT < exitStart + leave.duration) {
    const progress = (localT - exitStart) / leave.duration;
    const sample = revealOffset(leave.type, progress, leave.distance, false, leave.easing);

    return { phase: 'exit', progress, ...sample };
  }

  return { phase: 'after', progress: 1, opacity: 0, ...offsetAt(leave, 1, false) };
}

// The translate-only slice of a fully-settled sample (opacity handled by the caller's phase).
function offsetAt(
  normalized: { type: string; distance: number },
  progress: number,
  entering: boolean
): { translateX: number; translateY: number } {
  const { translateX, translateY } = revealOffset(normalized.type, progress, normalized.distance, entering);

  return { translateX, translateY };
}
