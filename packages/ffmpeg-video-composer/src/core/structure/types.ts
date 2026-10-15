// Shapes of the reference-structure analyzer (core/structure). It reads a clip's format — shots, rhythm,
// transitions, grounds, where the detail sits, motion — from luma alone: never a subject, a logo or text.

import type { StyleFrame } from '../style/types';

export type TransitionGuess = 'cut' | 'dissolve' | 'dip';

export type Ground = 'dark' | 'mid' | 'light';

/** The 3×3 cell holding most of a shot's detail, or `spread` when no cell clearly leads. */
export type Anchor =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'center'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right'
  | 'spread';

export interface Boundary {
  /** Index into the frame differences: the cut sits between frame `index` and frame `index + 1`. */
  index: number;
  /** Seconds, midway between the two frames. */
  time: number;
  transition: TransitionGuess;
}

export interface Shot {
  index: number;
  start: number;
  end: number;
  duration: number;
  /** How the shot is entered; null for the first. */
  transitionIn: TransitionGuess | null;
  ground: Ground;
  anchor: Anchor;
  /** 0..1: mean frame difference inside the shot, scaled. */
  motion: number;
}

export interface ReferenceStructure {
  duration: number;
  shots: Shot[];
  rhythm: { shots: number; avgShot: number; shortest: number; longest: number; cutsPerMinute: number };
}

export interface StructureInput {
  frames: StyleFrame[];
  /** Clip duration in seconds, when known (otherwise the last frame time plus one interval). */
  duration?: number;
}
