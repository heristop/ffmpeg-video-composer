// fx "bloom": highlight halation built from the picture itself (schemas/fx-ambient.schemas.ts for the fields).
//
// A copy of the target region (a kit tap) is reduced to a highlight mask (a smoothstep of luma around
// `threshold`, `knee` wide), blurred at half resolution (smooth content, a quarter of the work) and scaled
// back, then used as the alpha of a warm light colour laid over the picture: bright areas bleed a soft halo
// into their surroundings. The mask is blurred at full 8-bit range and only then scaled to the peak (≤ 0.12),
// with a static ±1 dither, so the halo's tail never bands. Ambient: soft ramps at both ends of the life;
// absent under reduced motion. Needs gblur and alphamerge (skipped with a warning otherwise).

import type { Filter, FilterGraphChain } from '@/core/types';
import { fmt } from '@/core/motion/hermite';
import { shiftTo, sourceTiming, type FxContext, type FxEffect, type FxLayer } from './fx-kit';
import { ambientRamps, even, fromWindow, hexOf, mix, rgbOf, softDither, type Rgb } from './fx-light-kit';

const WARM: Rgb = [0xff, 0xd9, 0xa8];
const WHITE: Rgb = [255, 255, 255];

export interface Bloom {
  /** Luma on the full-range gray plane (yuv → gray stretches 16..235 to 0..255): mask start and full. */
  low: number;
  high: number;
  /** Blur σ at full resolution, px. */
  sigma: number;
  color: string;
}

// Context defaults, drawn in a fixed order: threshold, radius.
export function bloomOf(fx: FxContext<'bloom'>): Bloom {
  const g = fx.graphic;
  const [thresholdDraw, radiusDraw] = [fx.random(), fx.random()];
  const threshold = g.threshold ?? 0.68 + thresholdDraw * 0.1;
  const knee = g.knee ?? 0.12;
  const radius = g.radius ?? 0.011 * (0.85 + radiusDraw * 0.3);
  const centre = 255 * threshold;
  const color = g.color ? fx.color : hexOf(mix(rgbOf(fx.color) ?? WHITE, WARM, 0.5));

  return {
    low: centre - (255 * knee) / 2,
    high: centre + (255 * knee) / 2,
    sigma: Math.max(1, radius * Math.min(fx.target.w, fx.target.h)),
    color,
  };
}

/** Luma → highlight mask (0..255): a smoothstep from `low` to `high`. */
export function highlightMask(low: number, high: number): string {
  const u = `clip((val-${fmt(low)})/${fmt(Math.max(1, high - low))},0,1)`;

  return `y='255*${u}*${u}*(3-2*${u})'`;
}

function maskChain(fx: FxContext<'bloom'>, bloom: Bloom, tap: string, out: string): FilterGraphChain {
  const { w, h } = fx.target;
  const filters: Filter[] = [
    fromWindow(fx),
    { type: 'format', value: 'gray' },
    { type: 'lutyuv', value: highlightMask(bloom.low, bloom.high) },
    { type: 'scale', value: `${even(w / 2)}:${even(h / 2)}` },
    { type: 'gblur', value: `sigma=${fmt(bloom.sigma / 2)}` },
    { type: 'scale', value: `${w}:${h}` },
  ];

  return { inputs: [tap], filters, outputs: [out] };
}

function lower(fx: FxContext<'bloom'>): FxLayer[] | null {
  if (fx.reduced) return [];

  if (!fx.has('gblur') || !fx.has('alphamerge')) return null;

  const bloom = bloomOf(fx);
  const p = fx.prefix;
  const { w, h } = fx.target;
  const light: Filter[] = [{ type: 'color', value: `c=${bloom.color}:s=${w}x${h}:${sourceTiming(fx)}` }, shiftTo(fx)];
  const chains: FilterGraphChain[] = [
    maskChain(fx, bloom, `${p}tap`, `${p}bm`),
    { filters: light, outputs: [`${p}bc`] },
    {
      inputs: [`${p}bc`, `${p}bm`],
      filters: [
        { type: 'alphamerge' },
        { type: 'format', value: 'yuva444p' },
        { type: 'lutyuv', value: `a=val*${fmt(fx.peak)}` },
        ...softDither(fx),
        ...ambientRamps(fx, fx.graphic.ramp ?? 0.5),
      ],
      outputs: [`${p}bl`],
    },
  ];

  return [{ chains, label: `${p}bl`, x: '0', y: '0', taps: [`${p}tap`] }];
}

export const BLOOM: FxEffect<'bloom'> = { lower };
