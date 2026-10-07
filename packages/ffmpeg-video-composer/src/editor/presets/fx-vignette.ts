// fx "vignette-breathe": a slow vignette that breathes (schemas/fx-ambient.schemas.ts for the fields).
//
// A white canvas at half resolution goes through `vignette` with a per-frame angle (angle ± swing on a sine
// of `period`), centred on `focus`; its darkening (255 − value) is scaled so the farthest corner reaches the
// peak (≤ 0.12) at the widest breath, scaled back up (smooth content) and used as the alpha of a near-black
// colour laid over the target: a multiply-like darkening of the edges that never touches the focus. Without
// `vignette`, a still radial `gradients` falloff of the same profile stands in (no breathing). Ambient: soft
// ramps at both ends of the life; absent under reduced motion.

import type { Filter, FilterGraphChain } from '@/core/types';
import { fmt } from '@/core/motion/hermite';
import { gradientSeed, shiftTo, sourceTiming, type FxContext, type FxEffect, type FxLayer } from './fx-kit';
import { ambientRamps, even, softDither } from './fx-light-kit';

/** Near-black with a hint of warmth: a lens falloff, not a grey wash. */
export const SHADE = '#0A0806';
export const RAMP = 0.6;
const STOPS = 8;

export interface Vignette {
  angle: number;
  swing: number;
  period: number;
  fx: number;
  fy: number;
  /** Alpha per unit of darkening (255 − vignette value), capped at the peak. */
  gain: number;
}

// Context defaults, drawn in a fixed order: angle, period, focus x, focus y.
export function vignetteOf(fx: FxContext<'vignette-breathe'>): Vignette {
  const g = fx.graphic;
  const draws = [fx.random(), fx.random(), fx.random(), fx.random()];
  const angle = g.angle ?? 0.55 + draws[0] * 0.15;
  const swing = g.swing ?? 0.04;
  const widest = Math.min(Math.PI / 2, angle + swing);

  return {
    angle,
    swing,
    period: g.period ?? 5.4 + draws[1] * 1.2,
    fx: g.focus?.x ?? 0.48 + draws[2] * 0.04,
    fy: g.focus?.y ?? 0.43 + draws[3] * 0.04,
    gain: fx.peak / (1 - Math.cos(widest) ** 4),
  };
}

/** The mask's alpha from the vignette's output: darkening × gain, capped at the peak. */
function alphaOf(v: Vignette, peak: number): string {
  return `y='min(${fmt(255 * peak)},(255-val)*${fmt(v.gain)})'`;
}

function vignetteMask(fx: FxContext<'vignette-breathe'>, v: Vignette): Filter[] {
  const [w, h] = [even(fx.target.w / 2), even(fx.target.h / 2)];
  const angle =
    v.swing > 0 ? `${fmt(v.angle)}+${fmt(v.swing)}*sin(2*PI*(t-${fmt(fx.at)})/${fmt(v.period)})` : fmt(v.angle);

  return [
    { type: 'color', value: `c=white:s=${w}x${h}:${sourceTiming(fx)}` },
    shiftTo(fx),
    { type: 'format', value: 'gray' },
    // White is 255 on a gray plane in every FFmpeg (a white `color` alone is 235 on 6.x).
    { type: 'lutyuv', value: 'y=255' },
    { type: 'vignette', value: `angle='${angle}':x0=${fmt(v.fx * w)}:y0=${fmt(v.fy * h)}:eval=frame` },
    { type: 'lutyuv', value: alphaOf(v, fx.peak) },
  ];
}

// The radial gradient's endpoints: the focus, and the point at the half-diagonal toward the farthest
// corner (always inside: that corner is at least the half-diagonal away). Both stay inside the source, which
// would otherwise replace an outside endpoint with a random one.
function radialEnds(v: Vignette, w: number, h: number): string {
  const [cx, cy] = [Math.min(w - 1, Math.round(v.fx * w)), Math.min(h - 1, Math.round(v.fy * h))];
  const [kx, ky] = [cx < w / 2 ? w - 1 : 0, cy < h / 2 ? h - 1 : 0];
  const t = Math.min(1, Math.hypot(w / 2, h / 2) / Math.max(1, Math.hypot(kx - cx, ky - cy)));

  return `x0=${cx}:y0=${cy}:x1=${Math.round(cx + (kx - cx) * t)}:y1=${Math.round(cy + (ky - cy) * t)}`;
}

// The still stand-in: the same falloff (1 − cos⁴) as a radial gradient from the focus to the far corner.
function gradientMask(fx: FxContext<'vignette-breathe'>, v: Vignette): Filter[] {
  const [w, h] = [even(fx.target.w / 2), even(fx.target.h / 2)];
  const colors = Array.from({ length: STOPS }, (_, i) => {
    const dark = 1 - Math.cos((v.angle * i) / (STOPS - 1)) ** 4;
    const level = Math.round(255 * Math.min(fx.peak, dark * v.gain));

    return `c${i}=0x${level.toString(16).padStart(2, '0').repeat(3)}`;
  }).join(':');
  const value =
    `s=${w}x${h}:type=radial:${colors}:nb_colors=${STOPS}:${radialEnds(v, w, h)}` +
    `:speed=0.00001:${gradientSeed(fx)}:${sourceTiming(fx)}`;

  // Gray stops convert to the same values on a gray plane (RGB → gray is full range).
  return [{ type: 'gradients', value }, shiftTo(fx), { type: 'format', value: 'gray' }];
}

function maskFilters(fx: FxContext<'vignette-breathe'>, v: Vignette): Filter[] | null {
  if (fx.has('vignette')) return vignetteMask(fx, v);

  return fx.has('gradients') ? gradientMask(fx, v) : null;
}

function lower(fx: FxContext<'vignette-breathe'>): FxLayer[] | null {
  if (fx.reduced) return [];

  const v = vignetteOf(fx);
  const mask = maskFilters(fx, v);

  if (!mask || !fx.has('alphamerge')) return null;

  const p = fx.prefix;
  const { w, h } = fx.target;
  const shade = fx.graphic.color ? fx.color : SHADE;
  const chains: FilterGraphChain[] = [
    { filters: [...mask, { type: 'scale', value: `${w}:${h}` }], outputs: [`${p}vm`] },
    {
      filters: [{ type: 'color', value: `c=${shade}:s=${w}x${h}:${sourceTiming(fx)}` }, shiftTo(fx)],
      outputs: [`${p}vc`],
    },
    {
      inputs: [`${p}vc`, `${p}vm`],
      filters: [
        { type: 'alphamerge' },
        { type: 'format', value: 'yuva444p' },
        ...softDither(fx),
        ...ambientRamps(fx, RAMP),
      ],
      outputs: [`${p}vg`],
    },
  ];

  return [{ chains, label: `${p}vg`, x: '0', y: '0' }];
}

export const VIGNETTE_BREATHE: FxEffect<'vignette-breathe'> = { lower };
