// Text-sugar descriptor types (title card, lower third, caption) plus the shared reveal/exit/text-effect
// vocabulary and the chroma-key block. Split out of `types.d.ts` to keep that file under the max-lines
// budget; re-exported from there so importers keep a single `@/core/types` entry point. Self-contained
// (no import back into `types.d.ts`) so the module graph stays acyclic — a localised string map is
// spelled inline as `Record<string, string | undefined>` (the `Translation` shape) to avoid a cycle.

import type { FontInput } from './fonts';

export type RevealType = 'none' | 'fade' | 'rise' | 'slide-left' | 'slide-right';
export type RevealEasing = 'linear' | 'ease-out' | 'ease-in-out' | 'ease-out-back';
export type Reveal =
  | RevealType
  | { type: RevealType; delay?: number; duration?: number; distance?: number; easing?: RevealEasing };
export type Exit =
  | RevealType
  | { type: RevealType; after?: number; duration?: number; distance?: number; easing?: RevealEasing };

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
}

export interface LowerThird {
  title?: Record<string, string | undefined>;
  subtitle?: Record<string, string | undefined>;
  accent?: string;
  boxOpacity?: number;
  position?: 'bottom' | 'top';
  badge?: Record<string, string | undefined>;
  reveal?: Reveal;
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
}
