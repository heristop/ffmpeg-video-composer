// Text-sugar descriptor types (title card, lower third, caption) plus the shared reveal/exit/text-effect
// vocabulary and the chroma-key block. Split out of `types.d.ts` to keep that file under the max-lines
// budget; re-exported from there so importers keep a single `@/core/types` entry point. Self-contained
// (no import back into `types.d.ts`) so the module graph stays acyclic — a localised string map is
// spelled inline as `Record<string, string | undefined>` (the `Translation` shape) to avoid a cycle.

import type { FontInput } from './fonts';
import type { MotionRole } from '../schemas/motion.schemas';

export type RevealType = 'none' | 'fade' | 'rise' | 'slide-left' | 'slide-right';
// The four historical names, or any easing spec: springs, beziers, named curves, $tokens.
export type RevealEasing = string | { points: Array<[number, number]> };
export type Reveal =
  | RevealType
  | { type: RevealType; delay?: number; duration?: number; distance?: number; easing?: RevealEasing };
export type Exit =
  | RevealType
  | { type: RevealType; after?: number; duration?: number; distance?: number; easing?: RevealEasing };

/**
 * Seconds, or a section-local time reference resolved at compile time: "title.end + 0.2", "50%",
 * "end - 0.5", "beat:12", "bar:3", "cue:drop - 0.1" (see schemas/time.schemas.ts).
 */
export type TimeValue = number | string;
/** A drawtext filter's reveal: `delay` may be a time reference. */
export type TimedReveal =
  | RevealType
  | { type: RevealType; delay?: TimeValue; duration?: number; distance?: number; easing?: RevealEasing };
/** A drawtext filter's exit: `after` may be a time reference. */
export type TimedExit =
  | RevealType
  | { type: RevealType; after?: TimeValue; duration?: number; distance?: number; easing?: RevealEasing };

export type TextEffect = {
  shadow?: boolean | { color?: string; dx?: number; dy?: number };
  outline?: boolean | { color?: string; width?: number };
};

export interface TitleCard {
  kicker?: Record<string, string | undefined>;
  headline?: Record<string, string | undefined>;
  subtitle?: Record<string, string | undefined>;
  accent?: string;
  align?: 'left' | 'center';
  background?: string;
  reveal?: Reveal;
  stagger?: number;
  fade?: { in?: boolean; out?: boolean };
  /** Motion role (global.motion.roles): fills the reveal easing/duration left unset. */
  role?: MotionRole;
}

export interface LowerThird {
  title?: Record<string, string | undefined>;
  subtitle?: Record<string, string | undefined>;
  accent?: string;
  boxOpacity?: number;
  position?: 'bottom' | 'top';
  badge?: Record<string, string | undefined>;
  reveal?: Reveal;
  /** Layout and animation preset; unset keeps the full-width band. */
  style?: 'clean-bar' | 'side-rule' | 'kicker' | 'stack-bars' | 'pill';
  /** Motion role (global.motion.roles): fills the reveal easing/duration left unset. */
  role?: MotionRole;
}

export interface ChromaKey {
  color: string;
  similarity?: number;
  blend?: number;
  background?: string;
}

export interface Caption {
  text: Record<string, string>;
  style?: 'bar' | 'subtle' | 'bold';
  position?: 'top' | 'center' | 'bottom' | 'lower-third';
  align?: 'left' | 'center' | 'right';
  font?: FontInput;
  fontsize?: number;
  color?: string;
  box?: boolean;
  boxColor?: string;
  boxOpacity?: number;
  reveal?: Reveal;
  effect?: TextEffect;
  wrap?: 'greedy' | 'balanced';
  fit?: { minSize?: number; maxLines?: number };
}
