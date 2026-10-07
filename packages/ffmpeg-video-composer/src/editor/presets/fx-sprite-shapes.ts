// The coverage (alpha, 0..1) of every fx sprite shape at a pixel centre, analytic and anti-aliased.
// Kept apart from the encoder/URL plumbing (fx-sprites.ts). Light shapes fall off as gaussians (no edge
// anywhere); solid shapes (strokes, masks, confetti) get a 1 px anti-aliased edge from a signed distance.

import { bokehCoverage, featherCoverage, rimCoverage } from './fx-sprite-shapes-soft';

export type SpriteKind =
  | 'disc'
  | 'ring'
  | 'star'
  | 'stroke'
  | 'mask'
  | 'piece'
  | 'band'
  | 'bokeh'
  | 'rim'
  | 'feather'
  | 'glow';

/** Light profiles across a band: a specular core with bloom, one soft wash, or two thin parallel glints. */
export const BAND_PROFILES = ['specular', 'soft', 'twin'] as const;
export type BandProfile = (typeof BAND_PROFILES)[number];

/**
 * A sprite, generated at its exact on-screen size. Each kind reads only its own fields:
 * - disc: gaussian light disc, `sigma` px (w = h).
 * - ring: anti-aliased annulus of `radius` and `stroke` px with a gaussian `halo` (σ px) around it (w = h ≥
 *   2·(radius + 3·halo), or the halo is cut square at the image edge).
 * - star: four-point glint, gaussian core `sigma` px and cross flares of σ `flare` px at a 6:1 aspect (w = h).
 * - stroke: rounded-rectangle outline, `stroke` px inside the edge, corner `radius` px.
 * - mask: rounded-rectangle fill as a GRAYSCALE image (alphamerge input), corner `radius` px.
 * - piece: confetti piece filling the box, `shape` rect or disc (an ellipse in a non-square box).
 * - band: tilted light band through the centre, `tilt` degrees off vertical, peak alpha `peak`, shaped by
 *   `profile` (bandProfile): specular = core of extent `width` px (±2σ) plus a bloom twice as wide
 *   carrying `bloom` of the peak; soft = one wider gaussian (σ = width / 3); twin = two thin cores.
 * - bokeh, rim, feather (fx-sprite-shapes-soft.ts): a defocused disc of `radius` with a `halo` px edge and
 *   peak `peak`; a top-lit rounded outline (`stroke`, `radius`, `peak`); a GRAYSCALE rounded mask whose edge
 *   fades in over `halo` px.
 * - glow: gaussian bloom of σ `sigma` px, peak alpha `peak`, OUTSIDE a centred rounded rectangle inset
 *   `inset` px from every image edge (corner `radius` px); exactly transparent inside it.
 */
export interface SpriteSpec {
  kind: SpriteKind;
  w: number;
  h: number;
  /** 6-hex RGB without `#` (default ffffff). RGB is this colour everywhere; alpha carries the shape. */
  color?: string;
  sigma?: number;
  radius?: number;
  stroke?: number;
  halo?: number;
  flare?: number;
  width?: number;
  tilt?: number;
  bloom?: number;
  peak?: number;
  inset?: number;
  shape?: 'rect' | 'disc';
  profile?: BandProfile;
}

type Coverage = (x: number, y: number) => number;

/** Peak alpha of a ring's halo, relative to its stroke. */
const HALO_PEAK = 0.45;
/** A star flare's length-to-thickness ratio. */
const FLARE_ASPECT = 6;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function gauss(distance: number, sigma: number): number {
  return sigma > 0 ? Math.exp(-(distance * distance) / (2 * sigma * sigma)) : 0;
}

/** Signed distance from a point (relative to the box centre) to a rounded rectangle; negative inside. */
export function roundedRectDistance(px: number, py: number, spec: Pick<SpriteSpec, 'w' | 'h' | 'radius'>): number {
  const r = Math.min(spec.radius ?? 0, spec.w / 2, spec.h / 2);
  const qx = Math.abs(px) - spec.w / 2 + r;
  const qy = Math.abs(py) - spec.h / 2 + r;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));

  return outside + Math.min(Math.max(qx, qy), 0) - r;
}

function disc(spec: SpriteSpec): Coverage {
  return (x, y) => gauss(Math.hypot(x, y), spec.sigma ?? spec.w / 6);
}

function ring(spec: SpriteSpec): Coverage {
  const radius = spec.radius ?? spec.w / 3;
  const stroke = spec.stroke ?? 3;

  return (x, y) => {
    const d = Math.abs(Math.hypot(x, y) - radius);

    return Math.max(clamp01(stroke / 2 - d + 0.5), HALO_PEAK * gauss(d, spec.halo ?? 6));
  };
}

function star(spec: SpriteSpec): Coverage {
  const flare = spec.flare ?? spec.w / 6;
  const thin = flare / FLARE_ASPECT;

  return (x, y) => {
    const core = gauss(Math.hypot(x, y), spec.sigma ?? 2);
    const across = gauss(x, flare) * gauss(y, thin);
    const down = gauss(y, flare) * gauss(x, thin);

    return Math.max(core, across, down);
  };
}

function stroke(spec: SpriteSpec): Coverage {
  const half = (spec.stroke ?? 2) / 2;

  return (x, y) => clamp01(half - Math.abs(roundedRectDistance(x, y, spec) + half) + 0.5);
}

function mask(spec: SpriteSpec): Coverage {
  return (x, y) => clamp01(0.5 - roundedRectDistance(x, y, spec));
}

function piece(spec: SpriteSpec): Coverage {
  if (spec.shape !== 'disc') return () => 1;

  const [a, b] = [spec.w / 2, spec.h / 2];

  return (x, y) => clamp01(0.5 - (Math.hypot(x / a, y / b) - 1) * Math.min(a, b));
}

type ProfileSpec = Pick<SpriteSpec, 'width' | 'bloom' | 'peak' | 'profile'>;

const PROFILES: Record<BandProfile, (offset: number, width: number, bloom: number) => number> = {
  specular: (offset, width, bloom) => (1 - bloom) * gauss(offset, width / 4) + bloom * gauss(offset, width / 2),
  soft: (offset, width) => gauss(offset, width / 3),
  twin: (offset, width) => Math.max(gauss(offset - width * 0.35, width / 9), gauss(offset + width * 0.35, width / 9)),
};

/**
 * Alpha across a band at `offset` px from its centre line (peak at 0). Every profile reaches ~0 by
 * ±`width` px, so a band source spanning ±width never shows an edge.
 */
export function bandProfile(offset: number, spec: ProfileSpec): number {
  const shape = PROFILES[spec.profile ?? 'specular'];

  return (spec.peak ?? 1) * shape(offset, spec.width ?? 40, spec.bloom ?? 0.25);
}

function band(spec: SpriteSpec): Coverage {
  const theta = ((spec.tilt ?? 20) * Math.PI) / 180;
  const [nx, ny] = [Math.cos(theta), Math.sin(theta)];

  return (x, y) => bandProfile(x * nx + y * ny, spec);
}

// Light that starts at the rectangle's edge (anti-aliased over 1 px) and falls off outward only.
function glow(spec: SpriteSpec): Coverage {
  const inset = spec.inset ?? 0;
  const rect = { w: spec.w - 2 * inset, h: spec.h - 2 * inset, radius: spec.radius };
  const sigma = spec.sigma ?? 10;

  return (x, y) => {
    const d = roundedRectDistance(x, y, rect);

    return (spec.peak ?? 1) * clamp01(d + 0.5) * gauss(Math.max(0, d), sigma);
  };
}

const SHAPES: Record<SpriteKind, (spec: SpriteSpec) => Coverage> = {
  disc,
  ring,
  star,
  stroke,
  mask,
  piece,
  band,
  bokeh: bokehCoverage,
  rim: (spec) => rimCoverage(spec, roundedRectDistance),
  feather: (spec) => featherCoverage(spec, roundedRectDistance),
  glow,
};

/** The coverage function of a sprite, in pixel-centre coordinates relative to the image centre. */
export function spriteCoverage(spec: SpriteSpec): Coverage {
  return SHAPES[spec.kind](spec);
}
