// fx "glass": a frosted panel on its target rectangle (schemas/fx-surface.schemas.ts for the fields).
//
// The kit hands the effect a copy of the target region; it is blurred (the frost), then ONE lutyuv maps it
// into the glass: luma squeezed into a fixed band, chroma pulled toward neutral and the whole mixed toward
// the tint colour. The band is solved so that the tinted result keeps its brightest point at 0.40 of the
// luma range on dark glass (white text ≥ 4.5:1 whatever is behind) and its darkest at 0.66 on light glass
// (dark text ≥ 4.5:1). A seeded luma dither keeps the squeezed gradients from banding, a compile-time rim
// sprite lights the top edge, and the panel frosts in and clears out over `ramp`. fx-kit clips it to the
// target's rounded corners and composites it only inside the window. Without gblur (a host probe that
// lacks it) the panel is toned but not frosted: still legible. Reduced motion changes nothing: it does
// not move.

import type { Filter, FilterGraphChain } from '@/core/types';
import { fmt } from '@/core/motion/hermite';
import type { FxContext, FxEffect, FxLayer } from './fx-kit';

/** Luma band of the tinted glass, as shares of the limited range: dark glass tops out, light glass bottoms out. */
export const GLASS_LUMA = { darkMax: 0.4, darkMin: 0.03, lightMin: 0.66, lightMax: 0.94 };
const MAX_FROST = 40;
const RIM_CEILING = 0.35;
/** A default dark tint is the light colour scaled down to this share: a deep, accent-leaning shade. */
const DEEP_SHADE = 0.12;

export interface GlassLook {
  tone: 'dark' | 'light';
  /** Frost σ in px (0 = none). */
  frost: number;
  saturation: number;
  /** Rim peak alpha. */
  rim: number;
  ramp: number;
  /** Tint colour as 0..1 RGB and its mix. */
  tint: number[];
  mix: number;
}

function rgbOf(color: string): number[] {
  const hex = /^#?([0-9a-f]{6})$/i.exec(color)?.[1] ?? 'ffffff';

  return [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
}

// Context defaults, drawn in a fixed order: frost, saturation, highlight.
export function glassLook(fx: FxContext<'glass'>): GlassLook {
  const g = fx.graphic;
  const short = Math.min(fx.target.w, fx.target.h);
  const frost = (g.frost ?? 0.08 + fx.random() * 0.04) * short;
  const saturation = g.saturation ?? 0.45 + fx.random() * 0.2;
  const highlight = g.highlight ?? 0.6 + fx.random() * 0.25;
  const tone = g.tone ?? 'dark';
  const light = rgbOf(fx.color);
  const tint = g.color === undefined && tone === 'dark' ? light.map((c) => c * DEEP_SHADE) : light;
  const span = fx.end - fx.at;

  return {
    tone,
    frost: fx.has('gblur') ? Math.min(MAX_FROST, Math.round(frost * 2) / 2) : 0,
    saturation,
    rim: Math.round(RIM_CEILING * highlight * 1000) / 1000,
    ramp: Math.min(span / 2, Math.max(4 / fx.frame.fps, g.ramp ?? 0.3)),
    tint,
    mix: Math.min(0.9, fx.peak),
  };
}

/** BT.601 limited-range Y, U, V of a 0..1 RGB colour. */
export function yuvOf([r, g, b]: number[]): number[] {
  return [
    16 + 65.481 * r + 128.553 * g + 24.966 * b,
    128 - 37.797 * r - 74.203 * g + 112 * b,
    128 + 112 * r - 93.786 * g - 18.214 * b,
  ];
}

/** The glass's luma band before tinting, solved so the tinted band respects GLASS_LUMA. */
export function lumaBand(look: GlassLook): [number, number] {
  const [ty] = yuvOf(look.tint);
  const tint = (ty - 16) / 219;
  const a = look.mix;

  if (look.tone === 'dark') {
    const high = Math.max(0, Math.min(0.36, (GLASS_LUMA.darkMax - a * tint) / (1 - a)));

    return [Math.min(GLASS_LUMA.darkMin, high), high];
  }

  const low = Math.min(1, Math.max(0.7, (GLASS_LUMA.lightMin - a * tint) / (1 - a)));

  return [low, Math.max(low, GLASS_LUMA.lightMax)];
}

/** The single lutyuv that turns the frosted region into tinted glass. */
export function glassLut(look: GlassLook): string {
  const [low, high] = lumaBand(look);
  const [ty, tu, tv] = yuvOf(look.tint);
  const a = look.mix;
  const gain = (1 - a) * (high - low);
  const base = 16 + 219 * (1 - a) * low + a * (ty - 16) - gain * 16;
  const chroma = (1 - a) * look.saturation;
  const [cu, cv] = [tu, tv].map((tint) => fmt(128 + a * (tint - 128) - chroma * 128));

  return [
    `y='${fmt(base)}+${fmt(gain)}*clip(val,16,235)'`,
    `u='${cu}+${fmt(chroma)}*val'`,
    `v='${cv}+${fmt(chroma)}*val'`,
  ].join(':');
}

function rimChains(fx: FxContext<'glass'>, look: GlassLook, from: string, out: string): FilterGraphChain[] {
  const { w, h, radius } = fx.target;
  const stroke = Math.min(fx.frame.width, fx.frame.height) >= 1080 ? 2 : 1;
  const rim = look.rim > 0 ? fx.sprite('rim', { kind: 'rim', w, h, radius, stroke, peak: look.rim }) : null;

  if (!rim) return [{ inputs: [from], filters: [{ type: 'null' }], outputs: [out] }];

  return [{ inputs: [from, rim], filters: [{ type: 'overlay', value: '0:0:format=yuv444' }], outputs: [out] }];
}

function lower(fx: FxContext<'glass'>): FxLayer[] {
  const p = fx.prefix;
  const look = glassLook(fx);
  const frost: Filter[] = look.frost > 0 ? [{ type: 'gblur', value: `sigma=${fmt(look.frost)}` }] : [];
  const glass: FilterGraphChain = {
    inputs: [`${p}g`],
    filters: [
      ...frost,
      { type: 'lutyuv', value: glassLut(look) },
      { type: 'noise', value: `c0s=2:c0f=t+u:all_seed=${fx.seed % 2147483647}` },
      { type: 'format', value: 'yuva444p' },
    ],
    outputs: [`${p}gb`],
  };
  const fades: FilterGraphChain = {
    inputs: [`${p}gr`],
    filters: [
      { type: 'format', value: 'yuva444p' },
      { type: 'fade', value: `t=in:st=${fmt(fx.at)}:d=${fmt(look.ramp)}:alpha=1` },
      { type: 'fade', value: `t=out:st=${fmt(fx.end - look.ramp)}:d=${fmt(look.ramp)}:alpha=1` },
    ],
    outputs: [`${p}gl`],
  };

  return [
    {
      chains: [glass, ...rimChains(fx, look, `${p}gb`, `${p}gr`), fades],
      label: `${p}gl`,
      x: '0',
      y: '0',
      taps: [`${p}g`],
    },
  ];
}

export const GLASS: FxEffect<'glass'> = { lower };
