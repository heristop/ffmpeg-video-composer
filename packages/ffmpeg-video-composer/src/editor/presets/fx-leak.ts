// fx "leak": a warm light leak from an off-frame source (schemas/fx-light.schemas.ts for the fields).
//
// Two soft radial lobes (primary `color`, `secondary` at `balance`) sit just outside one edge of the target,
// elongated along it, and drift along that edge on the pass ease while an eased envelope fades them in and
// then out more slowly. Each lobe is a `gradients` radial source rendered at half resolution with a compact
// bell profile ((1 − u²)³, exactly 0 at its radius, so no box edge ever shows), lightly blurred, scaled up to
// its ellipse and dithered; without `gradients` it is a compile-time gaussian disc sprite. A last layer puts
// the untouched picture back (alphamerge with a luma ramp) in the shadows and wherever the picture is already
// brighter than the light, so the leak lifts mid-tones, never the blacks, and never greys a bright surface
// (an "over" of a colour darker than the picture would). Reduced motion: a dimmer, still leak.

import type { Filter, FilterGraphChain } from '@/core/types';
import { fmt } from '@/core/motion/hermite';
import { gradientSeed, passProgress, sourceTiming, type FxContext, type FxEffect, type FxLayer } from './fx-kit';
import {
  colorOr,
  envelope,
  even,
  firstFrame,
  fromWindow,
  hexOf,
  holdFor,
  mix,
  rgbOf,
  softDither,
  type Rgb,
} from './fx-light-kit';

type Edge = NonNullable<FxContext<'leak'>['graphic']['edge']>;

const AMBER: Rgb = [0xff, 0xb3, 0x6b];
const ROSE: Rgb = [0xff, 0x7a, 0x88];
const STOPS = 8;
/** Share of the lobe radius the source sits outside its edge: the light comes from off-frame. */
const OFFSET = 0.15;
/**
 * Luma up to which the shadows are restored, on the full-range gray plane (yuv → gray stretches 16..235 to
 * 0..255): a smoothstep from black (0) to SPAN (≈ 40 code values above video black).
 */
const SPAN = 46;
/** Width of the ramp below the light's own luma where the picture is handed back (full-range gray). */
const KNEE = 28;
export const REDUCED_GAIN = 0.6;
const WHITE: Rgb = [255, 255, 255];
/** How far toward white the lobe's centre runs. */
const HOT_CORE = 0.45;

export interface Lobe {
  /** Centre at the start of the pass, target px. */
  cx: number;
  cy: number;
  /** Radii where the light reaches 0, px. */
  rx: number;
  ry: number;
  color: string;
  alpha: number;
}

export interface LeakPlan {
  lobes: Lobe[];
  /** Drift over the pass, px. */
  dx: number;
  dy: number;
}

const SIDES: Record<Edge, [number, number]> = {
  left: [0, -1],
  right: [1, -1],
  top: [-1, 0],
  bottom: [-1, 1],
  'top-left': [0, 0],
  'top-right': [1, 0],
  'bottom-left': [0, 1],
  'bottom-right': [1, 1],
};

function pick<T>(items: readonly T[], r: number): T {
  return items[Math.min(items.length - 1, Math.floor(r * items.length))];
}

// Context defaults, drawn in a fixed order: edge, place along it, size, stretch, drift, balance, spread, hue.
function draws(fx: FxContext<'leak'>): number[] {
  return Array.from({ length: 8 }, () => fx.random());
}

/** The anchor on the target's boundary (fx = 0..1 across, -1 = "along": placed by `along`). */
function anchor(edge: Edge, along: number, w: number, h: number): [number, number] {
  const [ax, ay] = SIDES[edge];

  return [ax < 0 ? along * w : ax * w, ay < 0 ? along * h : ay * h];
}

// The unit vector along the edge (the drift axis) and the outward normal.
function axes(edge: Edge, wide: boolean): { along: [number, number]; out: [number, number] } {
  const [ax, ay] = SIDES[edge];
  const vertical = ax >= 0 && (ay < 0 || !wide);
  const out: [number, number] = [ax < 0 ? 0 : ax * 2 - 1, ay < 0 ? 0 : ay * 2 - 1];

  return { along: vertical ? [0, 1] : [1, 0], out };
}

interface Geometry {
  along: [number, number];
  out: [number, number];
  /** Anchor on the boundary, target px. */
  x0: number;
  y0: number;
  radius: number;
  rx: number;
  ry: number;
  /** Length of the edge the leak runs along, px; `pos` = the anchor's place on it. */
  length: number;
  pos: number;
}

function geometry(fx: FxContext<'leak'>, r: number[]): Geometry {
  const g = fx.graphic;
  const { w, h } = fx.target;
  const wide = w >= h;
  const edge =
    g.edge ?? pick<Edge>(wide ? ['left', 'right', 'top-left', 'top-right'] : ['top-left', 'top-right', 'top'], r[0]);
  const { along, out } = axes(edge, wide);
  const horizontal = along[0] === 1;
  const [x0, y0] = anchor(edge, horizontal ? 0.25 + r[1] * 0.5 : 0.25 + r[1] * 0.2, w, h);
  const radius = (g.size ?? 0.3 + r[2] * 0.12) * Math.max(w, h);
  const stretch = g.stretch ?? 1 + r[3] * 0.3;
  const [rx, ry] = horizontal ? [radius * stretch, radius] : [radius, radius * stretch];

  return { along, out, x0, y0, radius, rx, ry, length: horizontal ? w : h, pos: horizontal ? x0 : y0 };
}

function lobesOf(fx: FxContext<'leak'>, r: number[], geo: Geometry): Lobe[] {
  const g = fx.graphic;
  const { along, out, radius } = geo;
  const tint = r[7] * 0.12;
  const spread = (g.spread ?? 0.5 + r[6] * 0.4) * radius * (geo.pos > geo.length / 2 ? -1 : 1);
  const first: Lobe = {
    cx: geo.x0 + out[0] * OFFSET * geo.rx,
    cy: geo.y0 + out[1] * OFFSET * geo.ry,
    rx: geo.rx,
    ry: geo.ry,
    color: colorOr(g.color, mix(AMBER, ROSE, tint)),
    alpha: fx.peak,
  };
  const second: Lobe = {
    cx: first.cx + along[0] * spread - out[0] * 0.1 * radius,
    cy: first.cy + along[1] * spread - out[1] * 0.1 * radius,
    rx: geo.rx * 0.7,
    ry: geo.ry * 0.7,
    color: colorOr(g.secondary, mix(ROSE, AMBER, tint)),
    alpha: fx.peak * (g.balance ?? 0.55 + r[5] * 0.25),
  };

  return second.alpha > 0.004 ? [first, second] : [first];
}

export function plan(fx: FxContext<'leak'>): LeakPlan {
  const r = draws(fx);
  const geo = geometry(fx, r);
  const drift = (fx.graphic.drift ?? (r[4] < 0.5 ? -1 : 1) * (0.06 + r[4] * 0.04)) * geo.length;

  return { lobes: lobesOf(fx, r, geo), dx: drift * geo.along[0], dy: drift * geo.along[1] };
}

/** A hotter, whiter core fading to the lobe's own colour by mid-radius: an exposure, not a tint. */
export function stopColor(color: string, u: number): string {
  const base = rgbOf(color) ?? AMBER;

  return hexOf(mix(mix(base, WHITE, HOT_CORE), base, Math.min(1, u * 1.8)));
}

/** The bell profile at the 8 stops from the centre (u = 0) to the radius (u = 1, exactly 0). */
export function leakStops(alpha: number): number[] {
  return Array.from({ length: STOPS }, (_, i) => {
    const u = i / (STOPS - 1);

    return alpha * (1 - u * u) ** 3;
  });
}

// The lobe's light at half resolution (a square of side `side`), as gradients or a disc sprite.
function lobeSource(fx: FxContext<'leak'>, lobe: Lobe, side: number, key: string): FilterGraphChain | null {
  if (!fx.has('gradients')) {
    const sprite = fx.sprite(key, {
      kind: 'disc',
      w: side,
      h: side,
      sigma: side / 6.4,
      color: lobe.color.slice(1).toLowerCase(),
    });

    return sprite
      ? {
          inputs: [sprite],
          filters: [
            ...firstFrame(fx),
            { type: 'format', value: 'yuva444p' },
            { type: 'lutyuv', value: `a=val*${fmt(lobe.alpha)}` },
          ],
        }
      : null;
  }

  const half = side / 2;
  const colors = leakStops(lobe.alpha)
    .map((alpha, i) => `c${i}=${stopColor(lobe.color, i / (STOPS - 1))}@${fmt(alpha)}`)
    .join(':');
  const value =
    `s=${side}x${side}:type=radial:${colors}:nb_colors=${STOPS}:x0=${half}:y0=${half}:x1=${side - 1}:y1=${half}` +
    `:speed=0.00001:${gradientSeed(fx)}:${sourceTiming(fx)}`;

  return { filters: [{ type: 'gradients', value }, ...firstFrame(fx), { type: 'format', value: 'yuva444p' }] };
}

function lobeLayer(fx: FxContext<'leak'>, lobe: Lobe, index: number, travel: LeakPlan): FxLayer | null {
  const label = `${fx.prefix}lk${index}`;
  const side = even(Math.max(lobe.rx, lobe.ry));
  const source = lobeSource(fx, lobe, side, `lobe${index}`);

  if (!source) return null;

  const g = fx.graphic;
  const [w, h] = [even(2 * lobe.rx), even(2 * lobe.ry)];
  const smooth: Filter = { type: 'gblur', value: `sigma=${fmt(Math.max(0.5, (side / 2 / (STOPS - 1)) * 0.35))}` };
  const filters: Filter[] = [
    ...source.filters,
    smooth,
    { type: 'scale', value: `${w}:${h}` },
    ...softDither(fx),
    holdFor(fx),
    ...envelope(fx, g.rise ?? 0.3, g.fall ?? 0.5),
  ];
  const p = fx.reduced ? '0' : passProgress(fx);
  const x = `${fmt(lobe.cx - w / 2)}+${fmt(travel.dx)}*(${p})`;
  const y = `${fmt(lobe.cy - h / 2)}+${fmt(travel.dy)}*(${p})`;

  return { chains: [{ ...source, filters, outputs: [label] }], label, x, y };
}

/**
 * The luma ramp that hands the picture back where the leak must not act: the shadows (1 at black, 0 from
 * SPAN up, smoothstep, scaled by `strength`) and everything at least as bright as the light itself (from
 * `light` − KNEE up to `light`), where laying a colour over would grey the picture instead of lighting it.
 */
export function protectRamp(strength: number, light: number): string {
  const u = `clip(val/${SPAN},0,1)`;
  const v = `clip((val-${fmt(light - KNEE)})/${KNEE},0,1)`;

  return `y='255*max(${fmt(strength)}*(1-${u}*${u}*(3-2*${u})),${v}*${v}*(3-2*${v}))'`;
}

/** Luma of a light colour on the full-range gray plane. */
function lumaOf(color: string): number {
  const [r, g, b] = rgbOf(color) ?? AMBER;

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// The untouched picture over the lit one, opaque where the leak must not act (shadows, brighter-than-light).
function shadowLayer(fx: FxContext<'leak'>, lobes: Lobe[]): FxLayer | null {
  const strength = fx.graphic.shadows ?? 1;

  if (!fx.has('alphamerge')) return null;

  const light = Math.min(...lobes.map((lobe) => lumaOf(lobe.color)));

  const p = fx.prefix;
  const chains: FilterGraphChain[] = [
    { inputs: [`${p}tap`], filters: [fromWindow(fx), { type: 'split', value: '2' }], outputs: [`${p}sc`, `${p}sm`] },
    {
      inputs: [`${p}sm`],
      filters: [
        { type: 'format', value: 'gray' },
        { type: 'lutyuv', value: protectRamp(strength, light) },
      ],
      outputs: [`${p}sa`],
    },
    { inputs: [`${p}sc`, `${p}sa`], filters: [{ type: 'alphamerge' }], outputs: [`${p}sh`] },
  ];

  return { chains, label: `${p}sh`, x: '0', y: '0', taps: [`${p}tap`] };
}

function lower(fx: FxContext<'leak'>): FxLayer[] | null {
  const travel = plan(fx);
  const lobes = travel.lobes.map((lobe) => (fx.reduced ? { ...lobe, alpha: lobe.alpha * REDUCED_GAIN } : lobe));
  const layers = lobes.map((lobe, i) => lobeLayer(fx, lobe, i, travel));

  if (layers.some((layer) => layer === null)) return null;

  const shadows = shadowLayer(fx, lobes);

  return [...(layers as FxLayer[]), ...(shadows ? [shadows] : [])];
}

export const LEAK: FxEffect<'leak'> = { lower };
