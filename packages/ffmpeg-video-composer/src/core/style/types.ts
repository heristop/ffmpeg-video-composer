// Shapes of the reference-style analyzer (core/style). The analyzer reads palette, texture and pacing
// from pixels only: it never describes, copies or reproduces a subject, a logo or any text it sees.

import type { MotionGenre } from '../motion/catalog-doctrine';
import type { ThemeColorName, ThemeInput } from '../theme/themes';
import type { Lab } from './oklab';

/** One decoded frame: packed RGB (3 channels, ffmpeg `rgb24`) or RGBA (4, canvas `getImageData`). */
export interface StyleFrame {
  data: ArrayLike<number>;
  width: number;
  height: number;
  /** Bytes per pixel: 3 (default) or 4. */
  channels?: 3 | 4;
  /** Presentation time in seconds (clips). */
  time?: number;
}

export interface StyleInput {
  frames: StyleFrame[];
  /** `image` analyses the palette and texture only; `clip` adds pacing and motion. Default: clip when >1 frame. */
  kind?: 'image' | 'clip';
  /** Clip duration in seconds, when known (otherwise inferred from frame times). */
  duration?: number;
  /**
   * Frames to read the palette and texture from instead of `frames` (e.g. a reference still next to a
   * clip that only sets the pacing). Pacing and motion always come from `frames`.
   */
  paletteFrames?: StyleFrame[];
  /** Seed for the palette's k-means initialisation. The same frames and seed give the same palette. */
  seed?: number;
}

export interface PaletteCluster {
  lab: Lab;
  hex: string;
  /** Share of sampled pixels in this cluster, 0..1. */
  share: number;
  chroma: number;
  hue: number;
}

/** How a role's colour was obtained: read as-is, moved in lightness to meet contrast, or synthesised. */
export type RoleSource = 'extracted' | 'adjusted' | 'derived';

export interface RoleColor {
  hex: string;
  source: RoleSource;
  /** Area share of the cluster the colour came from (0 when derived). */
  share: number;
}

export type ThemeRoles = Record<ThemeColorName, RoleColor>;

export interface PaletteEntry {
  hex: string;
  /** Roles this cluster fills (empty when it is reference-only). */
  roles: ThemeColorName[];
  share: number;
}

export interface ContrastCheck {
  pair: string;
  ratio: number;
  /** WCAG 2.1 AA for body text (≥ 4.5:1). */
  aa: boolean;
  /** WCAG 2.1 AA for large text and graphics (≥ 3:1). */
  aaLarge: boolean;
}

export interface Pacing {
  /** Average shot length, seconds. */
  avgShot: number;
  cutsPerMinute: number;
  cuts: number;
  /** Times (s) of the detected cuts. */
  cutTimes: number[];
}

export interface Texture {
  /** Estimated high-frequency noise, in 8-bit luma steps. */
  noise: number;
  look: 'grain' | 'none';
  /** A `global.grade.grain` strength (0..1) when the look is grain. */
  grain?: number;
}

export interface StyleGuide {
  source: { kind: 'image' | 'clip'; frames: number; duration?: number };
  palette: PaletteEntry[];
  roles: ThemeRoles;
  contrast: ContrastCheck[];
  pacing: Pacing | null;
  motion: { energy: number } | null;
  texture: Texture;
  genre: MotionGenre | null;
  rules: { keep: string[]; avoid: string[] };
  suggestions: string[];
}

export interface StyleAnalysis {
  /** A `global.theme` object: colours always, motion for clips. */
  theme: ThemeInput;
  styleGuide: StyleGuide;
  /** 0..1: how much the reference supports the derived theme. */
  confidence: number;
}
