// fx "ripple": anti-aliased rings expanding from a point of the target, or a tap (a dot pressed in and
// released, then one ring). Fields: schemas/fx-celebrate.schemas.ts.
//
// Each ring is ONE compile-time sprite rendered at its FINAL size (annulus + gaussian halo, fx-sprites
// `ring`), only ever scaled DOWN per frame (scale eval=frame on the eased pass progress), so it is sharp
// at every size. Its alpha decays as (1 - p)² (two chained alpha fades: an ease-out quad) after a 4-frame
// ramp in, so it never pops on or off. The tap dot is a solid anti-aliased disc sprite at its largest size,
// pressed 0.9 → 0.82 → 1 then faded. The region drawn over is a square around the origin that holds the
// final ring and its halo (fx-marks drawIn), so a ring may grow past the button it taps.
// Reduced motion: one still ring (or dot) at its middle size, faded in then out.

import type { Filter } from '@/core/types';
import { parseEasing } from '@/core/motion/easing';
import { easedProgressExpr, fmt } from '@/core/motion/hermite';
import type { FxContext, FxEffect, FxLayer } from './fx-kit';
import type { SpriteSpec } from './fx-sprites';
import {
  alphaScale,
  centredAt,
  drawIn,
  even,
  fadeIn,
  fadeOut,
  frameScale,
  rampOf,
  scaleTo,
  sizeExpr,
  spriteHex,
  spriteStream,
  themeColors,
  type Region,
} from './fx-marks';

type Ctx = FxContext<'ripple'>;

/** The ring's alpha relative to the peak (the full 0.85 peak: it decays as (1 - p)², so it must start strong to read on a dark card). */
const RING_ALPHA = 1;
/** Seconds of the tap's press (down then release). */
export const PRESS = 0.12;
/** Ring stroke in px at 1080p. */
const DEFAULT_STROKE = 5;
export const RELEASE_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
export const PRESS_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

export interface RipplePlan {
  tap: boolean;
  /** Final ring radius, ring sprite side, dot sprite side (px). */
  radius: number;
  side: number;
  dot: number;
  start: number;
  rings: number;
  stagger: number;
  /** Ring centre in region px. */
  cx: number;
  cy: number;
  color: string;
  spec: SpriteSpec;
}

interface Ring {
  radius: number;
  stroke: number;
  halo: number;
  side: number;
}

// The ring's size (px); the only seeded default is the radius jitter.
function ringOf(fx: Ctx, tap: boolean): Ring {
  const g = fx.graphic;
  const k = frameScale(fx);
  const share = g.radius ?? (tap ? 1.1 : 0.9) + fx.random() * 0.3;
  const radius = Math.max(6, share * Math.min(fx.target.w, fx.target.h));
  const stroke = Math.max(1, (g.stroke ?? DEFAULT_STROKE) * k);
  const halo = (g.halo ?? 6) * k;

  return { radius, stroke, halo, side: even(2 * (radius + stroke / 2 + 3 * halo) + 2) };
}

function colorOf(fx: Ctx): string {
  return (fx.graphic.color ? spriteHex(fx.color) : themeColors(fx, ['accent'])[0]) ?? 'ffffff';
}

export function planOf(fx: Ctx): RipplePlan | null {
  const g = fx.graphic;
  const tap = g.variant === 'tap';
  const ring = ringOf(fx, tap);
  const { x, y, w, h } = fx.target;
  const [ox, oy] = [x + (g.origin?.x ?? 0.5) * w, y + (g.origin?.y ?? 0.5) * h];
  const side = ring.side;
  const region = drawIn(fx, { x: Math.round(ox - side / 2), y: Math.round(oy - side / 2), w: side, h: side });
  const color = colorOf(fx);
  const dot = g.dot ?? 0.28;

  if (!region) return null;

  return {
    ...placement(region, ox, oy),
    tap,
    radius: ring.radius,
    side,
    dot: even(2 * dot * ring.radius),
    start: g.start ?? (tap ? dot : 0.375),
    rings: g.rings ?? (tap ? 1 : 2),
    stagger: g.stagger ?? 0.18,
    color,
    spec: {
      kind: 'ring',
      w: side,
      h: side,
      radius: round(ring.radius),
      stroke: round(ring.stroke),
      halo: round(ring.halo),
      color,
    },
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function placement(region: Region, ox: number, oy: number): { cx: number; cy: number } {
  return { cx: Math.round(ox - region.x), cy: Math.round(oy - region.y) };
}

interface Window {
  start: number;
  life: number;
}

// Ring i of a pass starting at `t0`: after the press for a tap, every ring inside the pass.
export function ringWindow(fx: Ctx, plan: RipplePlan, t0: number, i: number): Window {
  const lead = plan.tap ? PRESS * 0.4 : 0;
  const frame = 1 / fx.frame.fps;
  const stagger = Math.min(plan.stagger, (fx.duration - lead) / (plan.rings + 1));
  const life = Math.max(4 * frame, fx.duration - lead - (plan.rings - 1) * stagger);

  return { start: t0 + lead + i * stagger, life };
}

function ringFilters(fx: Ctx, plan: RipplePlan, win: Window): Filter[] {
  const p = easedProgressExpr(parseEasing(fx.ease), { delay: win.start, duration: win.life });
  const ramp = Math.min(rampOf(fx), win.life / 3);

  return [
    { type: 'trim', value: `start=${fmt(win.start)}:end=${fmt(win.start + win.life)}` },
    fadeIn(fx, win.start, ramp),
    ...fadeOut(fx, win.start, win.life, 2),
    scaleTo(sizeExpr(plan.side, `${fmt(plan.start)}+${fmt(1 - plan.start)}*(${p})`)),
  ];
}

// The dot of a tap: (1 - press) → (1 - 2·press) → 1 over PRESS, then a fade over the pass's second half.
function dotFilters(fx: Ctx, plan: RipplePlan, t0: number): Filter[] {
  const press = fx.graphic.press ?? 0.09;
  const down = easedProgressExpr(parseEasing(PRESS_EASE), { delay: t0, duration: PRESS * 0.4 });
  const up = easedProgressExpr(parseEasing(RELEASE_EASE), { delay: t0 + PRESS * 0.4, duration: PRESS * 0.6 });
  const factor = `${fmt(1 - press)}-${fmt(press)}*(${down})+${fmt(2 * press)}*(${up})`;
  const fadeAt = t0 + fx.duration * 0.45;

  return [
    { type: 'trim', value: `start=${fmt(t0)}:end=${fmt(t0 + fx.duration)}` },
    fadeIn(fx, t0, rampOf(fx)),
    ...fadeOut(fx, fadeAt, t0 + fx.duration - fadeAt, 2),
    scaleTo(sizeExpr(plan.dot, factor)),
  ];
}

function layer(label: string, filters: Filter[], plan: RipplePlan, out: string): FxLayer {
  return { chains: [{ inputs: [label], filters, outputs: [out] }], label: out, ...centredAt(plan.cx, plan.cy) };
}

function passStarts(fx: Ctx): number[] {
  return Array.from({ length: fx.passes }, (_, i) => fx.at + i * fx.every).filter((t0) => t0 < fx.end);
}

function rings(fx: Ctx, plan: RipplePlan): FxLayer[] | null {
  const starts = passStarts(fx);
  const windows = starts.flatMap((t0) => Array.from({ length: plan.rings }, (_, i) => ringWindow(fx, plan, t0, i)));
  const stream = spriteStream(fx, 'ring', plan.spec, windows.length, alphaScale(fx.peak * RING_ALPHA));

  if (!stream) return null;

  const layers = windows.map((win, i) =>
    layer(stream.labels[i], ringFilters(fx, plan, win), plan, `${fx.prefix}rg${i}`)
  );

  return [{ ...layers[0], chains: [...stream.chains, ...layers[0].chains] }, ...layers.slice(1)];
}

function dots(fx: Ctx, plan: RipplePlan): FxLayer[] | null {
  const starts = passStarts(fx);
  const spec: SpriteSpec = { kind: 'piece', shape: 'disc', w: plan.dot, h: plan.dot, color: plan.color };
  const stream = spriteStream(fx, 'dot', spec, starts.length, alphaScale(fx.peak));

  if (!stream) return null;

  const layers = starts.map((t0, i) => layer(stream.labels[i], dotFilters(fx, plan, t0), plan, `${fx.prefix}dt${i}`));

  return [{ ...layers[0], chains: [...stream.chains, ...layers[0].chains] }, ...layers.slice(1)];
}

// Reduced motion: the ring (or the dot) still, at its middle size, faded in then out over the window.
function pulse(fx: Ctx, plan: RipplePlan): FxLayer[] | null {
  const [key, spec, base] = plan.tap
    ? ['dot', { kind: 'piece', shape: 'disc', w: plan.dot, h: plan.dot, color: plan.color } as SpriteSpec, plan.dot]
    : ['ring', plan.spec, even(plan.side * (plan.start + 1) * 0.5)];
  const half = (fx.end - fx.at) / 2;
  const stream = spriteStream(fx, key, spec, 1, [
    ...alphaScale(fx.peak * (plan.tap ? 0.6 : RING_ALPHA)),
    fadeIn(fx, fx.at, half),
    ...fadeOut(fx, fx.at + half, half),
    { type: 'scale', value: `${base}:${base}` },
  ]);

  return stream ? [{ chains: stream.chains, label: stream.labels[0], ...centredAt(plan.cx, plan.cy) }] : null;
}

function lower(fx: Ctx): FxLayer[] | null {
  if (!fx.has('scale')) return null;

  const plan = planOf(fx);

  if (!plan) return null;

  if (fx.reduced) return pulse(fx, plan);

  const ringLayers = rings(fx, plan);
  const dotLayers = plan.tap ? dots(fx, plan) : [];

  return ringLayers && dotLayers ? [...dotLayers, ...ringLayers] : null;
}

export const RIPPLE: FxEffect<'ripple'> = { lower };
