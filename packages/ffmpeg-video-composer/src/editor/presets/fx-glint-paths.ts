// Where fx "glint" puts its light (fx-glint.ts): the star sprite, the scatter / corner spots on the target
// and the orbit path (small lights travelling around the target's edge with a fading trail).

import type { Filter } from '@/core/types';
import { fmt } from '@/core/motion/hermite';
import type { FxContext, FxLayer } from './fx-kit';
import type { SpriteSpec } from './fx-sprites';
import {
  alphaScale,
  centredAt,
  drawIn,
  even,
  fadeIn,
  fadeOut,
  frameScale,
  spriteHex,
  spriteStream,
  type Region,
} from './fx-marks';

type Ctx = FxContext<'glint'>;

/** The grow ease may overshoot: the sprite holds OVERSHOOT × the nominal size, so scaling stays ≤ 1. */
export const OVERSHOOT = 1.12;
/** Overlay budget of one glint graphic, all passes included. */
export const GLINT_BUDGET = 24;

/** The star sprite for a span of `size` px: flares (σ = side / 5) read to ~±2σ, so the side is ~1.25 × size. */
export function starSpec(size: number, color: string): SpriteSpec {
  const side = even(size * 1.25 * OVERSHOOT);

  return { kind: 'star', w: side, h: side, sigma: Math.max(1, Math.round(side * 0.6) / 10), flare: side / 5, color };
}

/** Pass starts that fit the overlay budget (`perPass` overlays each). */
export function glintPasses(fx: Ctx, perPass: number): number[] {
  const passes = Math.max(1, Math.min(fx.passes, Math.floor(GLINT_BUDGET / Math.max(1, perPass))));

  return Array.from({ length: passes }, (_, i) => fx.at + i * fx.every).filter((t0) => t0 < fx.end);
}

export interface Spot {
  /** Target fractions. */
  x: number;
  y: number;
  /** Twinkle order (0 first). */
  order: number;
}

// Specular-looking slots: the corners, then the upper half (where a top light catches), then the rest.
const SCATTER = [
  [0.1, 0.12],
  [0.88, 0.16],
  [0.32, 0.24],
  [0.68, 0.3],
  [0.5, 0.12],
  [0.14, 0.86],
  [0.86, 0.84],
  [0.24, 0.52],
  [0.78, 0.58],
];
const CORNERS = [
  [0.06, 0.08],
  [0.94, 0.08],
  [0.94, 0.92],
  [0.06, 0.92],
  [0.5, 0.06],
  [0.5, 0.94],
];

function shuffled<T>(items: T[], random: () => number): T[] {
  const out = [...items];

  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));

    [out[i], out[j]] = [out[j], out[i]];
  }

  return out;
}

/** `count` spots: authored points, corner slots, or seeded scatter slots (distinct, jittered ±4 %). */
export function glintSpots(
  path: 'scatter' | 'corners' | 'orbit',
  count: number,
  random: () => number,
  points?: Array<{ x: number; y: number }>
): Spot[] {
  const order = shuffled(
    Array.from({ length: count }, (_, i) => i),
    random
  );

  if (points) return points.map((point, i) => ({ ...point, order: order[i] }));

  const slots = path === 'corners' ? CORNERS.slice(0, count) : shuffled(SCATTER.slice(0, 5), random);
  const extra = path === 'corners' ? [] : shuffled(SCATTER.slice(5), random);
  const chosen = [...slots, ...extra].slice(0, count);

  return chosen.map(([x, y], i) => ({
    x: x + (random() - 0.5) * 0.08,
    y: y + (random() - 0.5) * 0.08,
    order: order[i],
  }));
}

interface Orbit {
  region: Region;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  phase: number;
  /** Radians per second. */
  omega: number;
  count: number;
  ghosts: number;
  /** Seconds between trail ghosts: they overlap into a streak (spacing ~1.2 ghost σ along the path). */
  lag: number;
}

/** A trail ghost's σ as a share of the head sprite side. */
const GHOST_SIGMA = 0.16;

function orbitOf(fx: Ctx, pad: number): Orbit | null {
  const g = fx.graphic;
  const { x, y, w, h } = fx.target;
  const region = drawIn(fx, { x: x - pad, y: y - pad, w: w + 2 * pad, h: h + 2 * pad });
  const phase = fx.random() * 2 * Math.PI;
  const count = g.count ?? 2;

  if (!region) return null;

  return {
    region,
    cx: x + w / 2 - region.x,
    cy: y + h / 2 - region.y,
    rx: w / 2,
    ry: h / 2,
    phase,
    omega: 2 * Math.PI * (g.speed ?? 0.9),
    count,
    ghosts: (g.trail ?? 0.4) > 0 ? Math.min(3, Math.floor(GLINT_BUDGET / count) - 1) : 0,
    lag: (1.2 * GHOST_SIGMA * pad * 2) / Math.max(1, 2 * Math.PI * (g.speed ?? 0.9) * ((w + h) / 4)),
  };
}

function orbitAt(orbit: Orbit, angle: string): { x: string; y: string } {
  return centredAt(
    `${fmt(orbit.cx)}+${fmt(orbit.rx)}*cos(${angle})`,
    `${fmt(orbit.cy)}+${fmt(orbit.ry)}*sin(${angle})`
  );
}

function envelope(fx: Ctx, t0: number, lag: number): Filter[] {
  const d = fx.duration;

  return [
    { type: 'trim', value: `start=${fmt(t0 + lag)}:end=${fmt(t0 + d)}` },
    fadeIn(fx, t0 + lag, d * 0.2),
    ...fadeOut(fx, t0 + d * 0.65, d * 0.35 - lag),
  ];
}

// One light (head or ghost `m`) of pass t0, light j: its chain from a stream branch and its path.
function light(fx: Ctx, orbit: Orbit, branch: string, slot: Slot): FxLayer {
  const lag = slot.m * orbit.lag;
  const start = orbit.phase + (2 * Math.PI * slot.j) / orbit.count;
  const angle = fx.reduced ? fmt(start) : `${fmt(start)}+${fmt(orbit.omega)}*(t-${fmt(slot.t0 + lag)})`;
  const fade = slot.m === 0 ? [] : alphaScale((fx.graphic.trail ?? 0.4) * (1 - (slot.m - 1) / orbit.ghosts));
  const label = `${fx.prefix}ob${slot.i}`;
  const filters = fx.reduced ? envelope(fx, slot.t0, 0) : [...envelope(fx, slot.t0, lag), ...fade];

  return { chains: [{ inputs: [branch], filters, outputs: [label] }], label, ...orbitAt(orbit, angle) };
}

interface Slot {
  t0: number;
  j: number;
  m: number;
  i: number;
}

// Every light of every pass, deepest ghosts first (drawn under) and heads last (drawn over).
function orbitSlots(fx: Ctx, orbit: Orbit, ghosts: number): Slot[] {
  const perPass = orbit.count * (1 + ghosts);
  const depths = Array.from({ length: ghosts + 1 }, (_, d) => ghosts - d);

  return glintPasses(fx, perPass)
    .flatMap((t0) => depths.flatMap((m) => Array.from({ length: orbit.count }, (_, j) => ({ t0, j, m, i: 0 }))))
    .map((slot, i) => ({ ...slot, i }));
}

function orbitSprites(fx: Ctx, size: number): { head: SpriteSpec; glow: SpriteSpec } {
  const k = frameScale(fx);
  const color = spriteHex(fx.color) ?? 'ffffff';
  const head = starSpec(size * k, color);
  const sigma = Math.max(1.5, head.w * GHOST_SIGMA);

  return { head, glow: { kind: 'disc', w: even(sigma * 6), h: even(sigma * 6), sigma, color } };
}

/** The orbit path: `count` lights around the target edge, each with up to three trail ghosts. */
export function orbitLayers(fx: Ctx): FxLayer[] | null {
  const { head, glow } = orbitSprites(fx, fx.graphic.size ?? 34);
  const orbit = orbitOf(fx, head.w / 2);

  if (!orbit) return null;

  const slots = orbitSlots(fx, orbit, fx.reduced ? 0 : orbit.ghosts);
  const headCount = slots.filter((slot) => slot.m === 0).length;
  const heads = spriteStream(fx, 'head', head, headCount, alphaScale(fx.peak));
  const trail = spriteStream(fx, 'ghost', glow, slots.length - headCount, alphaScale(fx.peak));

  if (!heads || (slots.length > headCount && !trail)) return null;

  const pools = [[...heads.labels], [...(trail?.labels ?? [])]];
  const layers = slots.map((slot) => light(fx, orbit, pools[slot.m === 0 ? 0 : 1].shift() as string, slot));

  return [
    { ...layers[0], chains: [...heads.chains, ...(trail?.chains ?? []), ...layers[0].chains] },
    ...layers.slice(1),
  ];
}
