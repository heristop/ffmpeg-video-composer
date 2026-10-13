// fx "burst": impact lines shooting out of a point (a like-button pop, a "BAM!"). Fields:
// schemas/fx-celebrate.schemas.ts.
//
// Each ray is a compile-time `ray` sprite (a solid capsule) ALREADY TURNED to its angle, at its longest
// length, so nothing rotates per frame; a capsule turned half a turn is itself, so opposite rays share one
// sprite. A ray is a trim path: its head runs from the inner to the outer radius over the first 60 % of its
// life, its tail follows over the last 70 % (both on the pass ease), so it grows from a stub, shoots out at
// full length, then shrinks into the outer radius. The overlay centres the sprite between head and tail
// (x/y expressions in t) and scales it down per frame to the head-tail distance (scale eval=frame, never
// up, floored at 30 %: the stroke thins with it). Alpha: a 4-frame ramp in, then a fade over the last
// 55 %. Dots (one shared disc sprite) ride between the rays a beat later and shrink as they go. The region is
// a square around the origin that holds the outer radius plus half a ray, unmasked (fx-marks drawIn): the
// rays leave the button they burst from. Jitter (seeded, drawn in a fixed order) offsets each ray's angle,
// reach, length and start. At most 48 overlays per graphic (later passes drop first).
// Reduced motion: the rays at rest at mid travel, 70 % long, faded in and out; no dots.
// Filters: fps, trim, split, colorchannelmixer, fade, scale (eval=frame), overlay: all on-device.

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
} from './fx-marks';

type Ctx = FxContext<'burst'>;

/** The overlay budget of one burst graphic, every pass included. */
export const BURST_BUDGET = 48;
/** Ray stroke in px at 1080p. */
const DEFAULT_THICKNESS = 6;
/** Default travel, in target short sides: from just outside the target's edge (along each ray), this far. */
const DEFAULT_GAP = 0.1;
const DEFAULT_TRAVEL = 0.55;
/** A dot's diameter, in ray strokes. */
export const DOT_SIZE = 2.4;
const DEFAULT_LENGTH = 0.5;
const DEFAULT_JITTER = 0.2;
const MAX_DOTS = 12;
/** The smallest share of its sprite a ray is drawn at (a stub at birth and at death). */
export const FLOOR = 0.3;
/** Shares of a ray's life: the head travels over [0, HEAD], the tail over [TAIL, 1], the fade from FADE. */
export const HEAD = 0.6;
export const TAIL = 0.3;
export const FADE = 0.45;
/** Dots start this share of the pass after the rays, and travel this share of the ray span. */
const DOT_DELAY = 0.08;
const DOT_TRAVEL = 0.75;
/** A dot ends this much smaller than it starts (its size is 1 - DOT_SHRINK · its travel). */
export const DOT_SHRINK = 0.6;

export interface Ray {
  /** Screen angle in degrees (0 = right, 90 = down). */
  angle: number;
  /** Travel from `inner` to `outer`, px from the origin; longest length, px. */
  inner: number;
  outer: number;
  length: number;
  start: number;
  life: number;
}

export interface Dot {
  angle: number;
  /** Radius it leaves from and the distance it travels, px. */
  from: number;
  travel: number;
  start: number;
  life: number;
}

export interface BurstPlan {
  /** Origin in region px. */
  ox: number;
  oy: number;
  thickness: number;
  color: string;
  rays: Ray[];
  dots: Dot[];
}

function colorOf(fx: Ctx): string {
  return (fx.graphic.color ? spriteHex(fx.color) : themeColors(fx, ['accent'])[0]) ?? 'ffffff';
}

/** The fan: `count` angles over `spread` degrees centred on up, turned by `rotation`; between = gap centres. */
function fan(count: number, spread: number, rotation: number, between: boolean): number[] {
  const centre = -90 + rotation;
  const full = spread >= 360;
  const step = full || between ? spread / count : spread / Math.max(1, count - 1);
  const first = full ? centre : centre - spread / 2;
  const offset = between ? step / 2 : 0;

  return Array.from({ length: count }, (_, i) => first + offset + i * step);
}

function dotCount(fx: Ctx, rays: number): number {
  const dots = fx.graphic.dots;

  if (dots === true) return Math.min(rays, MAX_DOTS);

  return typeof dots === 'number' ? dots : 0;
}

function passStarts(fx: Ctx, perPass: number): number[] {
  const starts = Array.from({ length: fx.passes }, (_, i) => fx.at + i * fx.every).filter((t0) => t0 < fx.end);

  return starts.slice(0, Math.max(1, Math.floor(BURST_BUDGET / perPass)));
}

interface Geometry {
  /** The origin in frame px, the target's size (the radius unit) and its box. */
  ox: number;
  oy: number;
  unit: number;
  box: { x: number; y: number; w: number; h: number };
}

// Distance along direction `d` from `from` to the side of [low, high] it heads to (none when it is still).
function exitAlong(from: number, [low, high]: [number, number], d: number): number {
  if (Math.abs(d) < 1e-9) return Infinity;

  return ((d > 0 ? high : low) - from) / d;
}

// Distance from the origin to the target's edge along `angle` (0 when the origin lies outside the target).
function edgeAlong(geo: Geometry, angle: number): number {
  const { x, y, w, h } = geo.box;
  const [c, s] = [Math.cos((angle * Math.PI) / 180), Math.sin((angle * Math.PI) / 180)];
  const inside = geo.ox >= x && geo.ox <= x + w && geo.oy >= y && geo.oy <= y + h;

  return inside ? Math.min(exitAlong(geo.ox, [x, x + w], c), exitAlong(geo.oy, [y, y + h], s)) : 0;
}

/** Where a ray (or dot) at `angle` travels: the authored [inner, outer], else just outside the target's edge. */
function travelAlong(fx: Ctx, geo: Geometry, angle: number): [number, number] {
  const authored = fx.graphic.radius;

  if (authored) return [authored[0] * geo.unit, authored[1] * geo.unit];

  const inner = edgeAlong(geo, angle) + DEFAULT_GAP * geo.unit;

  return [inner, inner + DEFAULT_TRAVEL * geo.unit];
}

// Rays and dots of every pass; seeded draws in a fixed order: per ray angle, reach, length, delay; per dot reach.
function partsOf(fx: Ctx, geo: Geometry, thickness: number): Pick<BurstPlan, 'rays' | 'dots'> {
  const g = fx.graphic;
  const count = g.rays ?? 8;
  const spread = g.spread ?? 360;
  const jitter = g.jitter ?? DEFAULT_JITTER;
  const step = spread / (spread >= 360 ? count : Math.max(1, count - 1));
  const shape = fan(count, spread, g.rotation ?? 0, false).map((angle) => {
    const turn = (fx.random() - 0.5) * jitter * step * 0.5;
    const reach = 1 + (fx.random() - 0.5) * jitter * 0.5;
    const stretch = 1 + (fx.random() - 0.5) * jitter * 0.8;
    const delay = fx.random() * jitter * 0.15 * fx.duration;
    const [inner, outer] = travelAlong(fx, geo, angle + turn);
    const far = inner + Math.max(1, outer - inner) * reach;

    return {
      angle: angle + turn,
      inner,
      outer: far,
      length: Math.max(thickness + 2, (g.length ?? DEFAULT_LENGTH) * (far - inner) * stretch),
      delay,
    };
  });
  const dotAngles = fan(dotCount(fx, count), spread, g.rotation ?? 0, true);
  const dotReach = dotAngles.map(() => 1 + (fx.random() - 0.5) * jitter * 0.6);
  const starts = passStarts(fx, shape.length + dotAngles.length);

  return {
    rays: starts.flatMap((t0) =>
      shape.map(({ delay, ...ray }) => ({ ...ray, start: t0 + delay, life: fx.duration - delay }))
    ),
    dots: starts.flatMap((t0) =>
      dotAngles.map((angle, i) => ({
        angle,
        ...dotPath(travelAlong(fx, geo, angle), dotReach[i]),
        start: t0 + DOT_DELAY * fx.duration,
        life: fx.duration * (1 - DOT_DELAY),
      }))
    ),
  };
}

function dotPath([inner, outer]: [number, number], reach: number): Pick<Dot, 'from' | 'travel'> {
  return { from: inner * 0.9, travel: Math.max(1, outer - inner) * DOT_TRAVEL * reach };
}

export function planOf(fx: Ctx): BurstPlan | null {
  const g = fx.graphic;
  const { x, y, w, h } = fx.target;
  const thickness = Math.max(1, (g.thickness ?? DEFAULT_THICKNESS) * frameScale(fx));
  const [ox, oy] = [x + (g.origin?.x ?? 0.5) * w, y + (g.origin?.y ?? 0.5) * h];
  // The target's size: its short side, or half its long side when that is larger (a pill, a wide badge).
  const unit = Math.max(Math.min(w, h), Math.max(w, h) / 2);
  const parts = partsOf(fx, { ox, oy, unit, box: { x, y, w, h } }, thickness);
  const reach = Math.max(...parts.rays.map((ray) => ray.outer + ray.length / 2)) + thickness + 4;
  // Snapped OUTWARD to even px here, so the kit's inward snap keeps the whole reach.
  const [left, top] = [2 * Math.floor((ox - reach) / 2), 2 * Math.floor((oy - reach) / 2)];
  const [right, bottom] = [2 * Math.ceil((ox + reach) / 2), 2 * Math.ceil((oy + reach) / 2)];
  const region = drawIn(fx, { x: left, y: top, w: right - left, h: bottom - top });

  if (!region) return null;

  return { ox: ox - region.x, oy: oy - region.y, thickness, color: colorOf(fx), ...parts };
}

/** The tilt a ray sprite is drawn at: its angle modulo a half turn (a capsule turned 180° is itself). */
function tiltOf(angle: number): number {
  const tilt = Math.round(((angle % 180) + 180) % 180);

  return tilt === 180 ? 0 : tilt;
}

export function raySpec(plan: BurstPlan, ray: Ray): SpriteSpec {
  const tilt = tiltOf(ray.angle);
  const length = even(ray.length);
  const thickness = Math.max(1, Math.round(plan.thickness));
  const theta = (tilt * Math.PI) / 180;
  const along = length - thickness;

  return {
    kind: 'ray',
    w: even(Math.abs(Math.cos(theta)) * along + thickness + 2),
    h: even(Math.abs(Math.sin(theta)) * along + thickness + 2),
    width: length,
    stroke: thickness,
    tilt,
    color: plan.color,
  };
}

function keyOf(spec: SpriteSpec): string {
  return `r${spec.tilt}_${spec.width}`;
}

interface Path {
  head: string;
  tail: string;
}

function pathOf(fx: Ctx, ray: Ray): Path {
  const curve = parseEasing(fx.ease);

  return {
    head: easedProgressExpr(curve, { delay: ray.start, duration: ray.life * HEAD }),
    tail: easedProgressExpr(curve, { delay: ray.start + ray.life * TAIL, duration: ray.life * (1 - TAIL) }),
  };
}

function rayFilters(fx: Ctx, ray: Ray, spec: SpriteSpec, path: Path): Filter[] {
  const span = ray.outer - ray.inner;
  const factor = `clip(((${path.head})-(${path.tail}))*${fmt(span / (spec.width ?? ray.length))},${FLOOR},1)`;
  const ramp = Math.min(rampOf(fx), ray.life / 4);

  return [
    { type: 'trim', value: `start=${fmt(ray.start)}:end=${fmt(ray.start + ray.life)}` },
    fadeIn(fx, ray.start, ramp),
    ...fadeOut(fx, ray.start + ray.life * FADE, ray.life * (1 - FADE)),
    scaleTo(sizeExpr(spec.w, factor), sizeExpr(spec.h, factor)),
  ];
}

// One axis of a point travelling along a ray: `start` px plus `gain` px times the progress expression.
function radialExpr(start: number, gain: number, progress: string): string {
  return `${fmt(start)}+${fmt(gain)}*${progress}`;
}

// The ray's centre: half way between head and tail, both on the ray's line.
function rayPosition(plan: BurstPlan, ray: Ray, path: Path): { x: string; y: string } {
  const theta = (ray.angle * Math.PI) / 180;
  const half = (ray.outer - ray.inner) / 2;
  const mid = `((${path.head})+(${path.tail}))`;

  return centredAt(
    radialExpr(plan.ox + Math.cos(theta) * ray.inner, Math.cos(theta) * half, mid),
    radialExpr(plan.oy + Math.sin(theta) * ray.inner, Math.sin(theta) * half, mid)
  );
}

export function dotSpec(plan: BurstPlan): SpriteSpec {
  const side = even(plan.thickness * DOT_SIZE);

  return { kind: 'piece', shape: 'disc', w: side, h: side, color: plan.color };
}

function dotLayer(fx: Ctx, plan: BurstPlan, dot: Dot, input: string, label: string): FxLayer {
  const travel = easedProgressExpr(parseEasing(fx.ease), { delay: dot.start, duration: dot.life });
  const [c, s] = [Math.cos((dot.angle * Math.PI) / 180), Math.sin((dot.angle * Math.PI) / 180)];
  const side = dotSpec(plan).w;
  const filters: Filter[] = [
    { type: 'trim', value: `start=${fmt(dot.start)}:end=${fmt(dot.start + dot.life)}` },
    fadeIn(fx, dot.start, Math.min(rampOf(fx), dot.life / 4)),
    ...fadeOut(fx, dot.start + dot.life * 0.5, dot.life * 0.5),
    scaleTo(sizeExpr(side, `1-${DOT_SHRINK}*(${travel})`)),
  ];

  return {
    chains: [{ inputs: [input], filters, outputs: [label] }],
    label,
    ...centredAt(
      radialExpr(plan.ox + c * dot.from, c * dot.travel, `(${travel})`),
      radialExpr(plan.oy + s * dot.from, s * dot.travel, `(${travel})`)
    ),
  };
}

// Reduced motion: the ray at rest half way along its travel, 70 % long, faded in then out over the window.
function stillRay(fx: Ctx, plan: BurstPlan, ray: Ray, spec: SpriteSpec): { filters: Filter[]; x: string; y: string } {
  const half = (fx.end - fx.at) / 2;
  const theta = (ray.angle * Math.PI) / 180;
  const radius = (ray.inner + ray.outer) / 2;

  return {
    filters: [
      fadeIn(fx, fx.at, half),
      ...fadeOut(fx, fx.at + half, half),
      { type: 'scale', value: `${even(spec.w * 0.7)}:${even(spec.h * 0.7)}` },
    ],
    ...centredAt(Math.round(plan.ox + Math.cos(theta) * radius), Math.round(plan.oy + Math.sin(theta) * radius)),
  };
}

function moving(fx: Ctx, plan: BurstPlan, ray: Ray, spec: SpriteSpec): { filters: Filter[]; x: string; y: string } {
  const path = pathOf(fx, ray);

  return { filters: rayFilters(fx, ray, spec, path), ...rayPosition(plan, ray, path) };
}

/** The ray sprites, keyed (shared by opposite rays), with every ray's branch label in order. */
function rayStreams(fx: Ctx, plan: BurstPlan, rays: Ray[]) {
  const specs = rays.map((ray) => raySpec(plan, ray));
  const keys = [...new Set(specs.map(keyOf))];
  const streams = keys.map((key) => {
    const spec = specs.find((candidate) => keyOf(candidate) === key) as SpriteSpec;

    return spriteStream(fx, key, spec, specs.filter((s) => keyOf(s) === key).length, alphaScale(fx.peak));
  });

  if (streams.some((stream) => !stream)) return null;

  const branches = new Map(keys.map((key, i) => [key, [...(streams[i]?.labels ?? [])]]));

  return {
    prep: streams.flatMap((stream) => stream?.chains ?? []),
    specs,
    inputs: specs.map((spec) => branches.get(keyOf(spec))?.shift() as string),
  };
}

function lower(fx: Ctx): FxLayer[] | null {
  if (!fx.has('scale')) return null;

  const plan = planOf(fx);

  if (!plan) return null;

  const rays = fx.reduced ? plan.rays.filter((ray) => ray.start < fx.at + fx.duration) : plan.rays;
  const dots = fx.reduced ? [] : plan.dots;
  const streams = rayStreams(fx, plan, rays);
  const dotStream = dots.length > 0 ? spriteStream(fx, 'dot', dotSpec(plan), dots.length, alphaScale(fx.peak)) : null;

  if (!streams || (dots.length > 0 && !dotStream)) return null;

  const rayLayers = rays.map((ray, i): FxLayer => {
    const label = `${fx.prefix}ry${i}`;
    const spec = streams.specs[i];
    const { filters, ...at } = fx.reduced ? stillRay(fx, plan, ray, spec) : moving(fx, plan, ray, spec);

    return { chains: [{ inputs: [streams.inputs[i]], filters, outputs: [label] }], label, ...at };
  });
  const dotLayers = dots.map((dot, i) => dotLayer(fx, plan, dot, dotStream?.labels[i] ?? '', `${fx.prefix}dt${i}`));
  const layers = [...dotLayers, ...rayLayers];
  const prep = [...streams.prep, ...(dotStream?.chains ?? [])];

  return [{ ...layers[0], chains: [...prep, ...layers[0].chains] }, ...layers.slice(1)];
}

export const BURST: FxEffect<'burst'> = { lower };
