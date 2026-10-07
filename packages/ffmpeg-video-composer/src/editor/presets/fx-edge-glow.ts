// fx "edge-glow": a lit edge around a card or video rect (schemas/fx-light.schemas.ts for the fields).
//
// Two compile-time sprites at their exact on-screen size, so nothing is ever scaled (portrait stays sharp):
// a crisp inner hairline (`stroke`, a whole number of px inside the target's rounded edge) and a gaussian
// bloom that lives OUTSIDE the target's shape only (`glow`: exactly transparent inside, anti-aliased at the
// edge). The effect draws in the target grown by the bloom's reach (fx-kit drawIn: unmasked, clamped to the
// frame), so the bloom can leave the card while the card itself is never tinted. Each sprite is processed once
// (firstFrame/holdFor) and faded in and out on an eased envelope; the bloom breathes through `hue`
// brightness on a sine (off under reduced motion, or without `hue`).

import type { Filter } from '@/core/types';
import { fnv1a32, seededRandom } from '@/core/determinism/hash';
import { fmt } from '@/core/motion/hermite';
import { drawIn, type FxContext, type FxEffect, type FxLayer } from './fx-kit';
import type { FxTargetRect } from './fx-target';
import { atFrame, envelope, even, firstFrame, hexOf, holdFor, mix, rgbOf, saturate, type Rgb } from './fx-light-kit';

const WHITE: Rgb = [255, 255, 255];
/** Bloom reach in σ: the canvas grows by this much on each side (the gaussian is < 1/255 beyond). */
const REACH = 3.4;
/** The light colour's tint, exaggerated into the bloom's (fx-light-kit saturate). */
const TINT_GAIN = 4;
/** Seconds of the entrance and exit ramps. */
export const ENTER = 0.35;
export const EXIT = 0.25;
/** Assumed backdrop luma for the breath: a ± share of the bloom's lift over a dark surround. */
const BACKDROP_Y = 30;
/** `hue` brightness unit in luma code values. */
const HUE_B_UNIT = 24;

export interface Glow {
  sigma: number;
  /** Canvas growth on each side, even px. */
  margin: number;
  line: number;
  lineWidth: number;
  color: Rgb;
  period: number;
  breathe: number;
}

// Context defaults, drawn in a fixed order (spread, then period) from a stream of the element's seed of its
// own (fx.random stays untouched for the dispatcher's own draws).
export function glowOf(fx: FxContext<'edge-glow'>): Glow {
  const g = fx.graphic;
  const random = seededRandom(fnv1a32(`${fx.seed}:edge-glow`));
  const [spreadDraw, periodDraw] = [random(), random()];
  const sigma = Math.max(1, atFrame(fx, g.spread ?? 8 + spreadDraw * 4));
  const color = rgbOf(g.glow) ?? saturate(rgbOf(fx.color) ?? WHITE, TINT_GAIN);

  return {
    sigma,
    margin: even(Math.ceil(REACH * sigma)),
    line: g.line ?? 0.55,
    lineWidth: Math.max(1, Math.round(atFrame(fx, g.lineWidth ?? 1.5))),
    color,
    period: g.period ?? 3.6 + periodDraw * 1.2,
    breathe: fx.reduced ? 0 : (g.breathe ?? 0.06),
  };
}

function luma(rgb: Rgb): number {
  return 16 + (219 * (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2])) / 255;
}

function hex(rgb: Rgb): string {
  return hexOf(rgb).slice(1).toLowerCase();
}

function breath(fx: FxContext<'edge-glow'>, glow: Glow): Filter[] {
  if (glow.breathe <= 0 || !fx.has('hue')) return [];

  const amplitude = (glow.breathe * Math.max(0, luma(glow.color) - BACKDROP_Y)) / HUE_B_UNIT;

  return [{ type: 'hue', value: `b='${fmt(amplitude)}*sin(2*PI*(t-${fmt(fx.at)})/${fmt(glow.period)})'` }];
}

function ramps(fx: FxContext<'edge-glow'>): Filter[] {
  const life = fx.end - fx.at;

  return envelope(fx, Math.min(0.45, ENTER / life), Math.min(0.45, EXIT / life));
}

function bloomLayer(fx: FxContext<'edge-glow'>, glow: Glow, t: FxTargetRect, origin: number[]): FxLayer | null {
  const m = glow.margin;
  const spec = { kind: 'glow', w: t.w + 2 * m, h: t.h + 2 * m, inset: m, radius: t.radius } as const;
  const sprite = fx.sprite('glow', {
    ...spec,
    sigma: Math.round(glow.sigma * 100) / 100,
    peak: Math.round(fx.peak * 1000) / 1000,
    color: hex(glow.color),
  });

  if (!sprite) return null;

  const label = `${fx.prefix}gl`;
  const filters: Filter[] = [
    ...firstFrame(fx),
    { type: 'format', value: 'yuva444p' },
    holdFor(fx),
    ...breath(fx, glow),
    ...ramps(fx),
  ];

  return {
    chains: [{ inputs: [sprite], filters, outputs: [label] }],
    label,
    x: `${origin[0] - m}`,
    y: `${origin[1] - m}`,
  };
}

function hairlineLayer(fx: FxContext<'edge-glow'>, glow: Glow, t: FxTargetRect, origin: number[]): FxLayer | null {
  if (glow.line <= 0) return null;

  const color = hex(mix(WHITE, glow.color, 0.15));
  const sprite = fx.sprite('line', { kind: 'stroke', w: t.w, h: t.h, radius: t.radius, stroke: glow.lineWidth, color });

  if (!sprite) return null;

  const label = `${fx.prefix}hl`;
  const filters: Filter[] = [
    ...firstFrame(fx),
    { type: 'format', value: 'yuva444p' },
    { type: 'lutyuv', value: `a=val*${fmt(glow.line)}` },
    holdFor(fx),
    ...ramps(fx),
  ];

  return { chains: [{ inputs: [sprite], filters, outputs: [label] }], label, x: `${origin[0]}`, y: `${origin[1]}` };
}

function lower(fx: FxContext<'edge-glow'>): FxLayer[] | null {
  const glow = glowOf(fx);
  const t = fx.target;
  const m = glow.margin;
  const area = drawIn(fx, { x: t.x - m, y: t.y - m, w: t.w + 2 * m, h: t.h + 2 * m });

  if (!area) return null;

  const origin = [t.x - area.x, t.y - area.y];
  const bloom = bloomLayer(fx, glow, t, origin);

  if (!bloom) return null;

  const line = hairlineLayer(fx, glow, t, origin);

  return line ? [bloom, line] : [bloom];
}

export const EDGE_GLOW: FxEffect<'edge-glow'> = { lower };
