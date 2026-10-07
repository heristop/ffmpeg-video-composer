// fx "bokeh" and "dust": ambient particles drifting inside their target (schemas/fx-particles.schemas.ts).
//
// Every particle is a compile-time sprite (fx-sprites.ts) rendered at its exact on-screen size, one sprite
// input per size tier, split once per particle. A particle's alpha is scaled from the sprite (lutyuv on the
// alpha plane), faded in and out over its life (`fade` in section time: looped stills start at 0 like the
// section) and laid over the target region at a drift + sway position evaluated per frame. The field is drawn
// from the element's seeded stream, so the same descriptor gives the same particles; omitted parameters
// derive from the target size, the seed and the motion energy. Peak alpha stays under the 0.12 ambient
// ceiling. Reduced motion (energy 0): no particles at all. Filters: format, split, lutyuv, fade, noise,
// overlay (all on the on-device allowlist); no optional filter, so no fallback is needed.

import type { Filter, FilterGraphChain } from '@/core/types';
import { fmt } from '@/core/motion/hermite';
import type { SpriteSpec } from './fx-sprites';
import { ditherFilters, type AnyFxContext, type FxContext, type FxEffect, type FxLayer } from './fx-kit';

/** One particle: where it starts, how it moves, how bright it is and when it lives (section seconds). */
export interface Particle {
  tier: number;
  /** Centre at the window start, target px. */
  x: number;
  y: number;
  /** Drift, px per second. */
  vx: number;
  vy: number;
  /** Sway across the drift: amplitude px (x and y parts), angular frequency rad/s, phase rad. */
  sx: number;
  sy: number;
  omega: number;
  phase: number;
  /** Alpha at the sprite's peak, already under the ceiling. */
  alpha: number;
  from: number;
  to: number;
  /** Fade-in and fade-out seconds. */
  ramp: number;
}

export interface ParticleField {
  /** One sprite per tier (its side is `spec.w`). */
  tiers: SpriteSpec[];
  particles: Particle[];
  dither: boolean;
}

interface Drift {
  /** Heading, radians (screen: +y is down). */
  heading: number;
  /** px per second. */
  speed: number;
}

/** Bokeh depth tiers, near to far: radius and alpha relative to the nearest tier. */
const BOKEH_TIERS = [
  { size: 1, alpha: 1, share: 0.25, soft: 1.35 },
  { size: 0.6, alpha: 0.82, share: 0.35, soft: 1 },
  { size: 0.35, alpha: 0.66, share: 0.4, soft: 0.7 },
];
/** Candidates tried per disc; the one farthest from the discs already placed wins (an even, unpatterned spread). */
const CANDIDATES = 6;
const MIN_RAMP_FRAMES = 4;
const MAX_LIVES = 48;

function energyScale(fx: AnyFxContext): number {
  return Math.min(2, Math.max(0.5, fx.energy));
}

function spriteColor(fx: AnyFxContext): Pick<SpriteSpec, 'color'> {
  return /^#[0-9a-f]{6}$/i.test(fx.color) ? { color: fx.color.slice(1).toLowerCase() } : {};
}

/** A position in the target, outside the centre's clear zone (`clear`: half-size as a share of the target). */
export function placeOutside(random: () => number, clear: number): [number, number] {
  let point: [number, number] = [random(), random()];

  for (let tries = 0; tries < 8 && Math.max(Math.abs(point[0] - 0.5), Math.abs(point[1] - 0.5)) < clear; tries++) {
    point = [random(), random()];
  }

  return point;
}

function gapTo([x, y]: [number, number], taken: [number, number][]): number {
  return Math.min(Infinity, ...taken.map(([tx, ty]) => Math.hypot(x - tx, y - ty)));
}

/** Best-candidate placement: of CANDIDATES points outside the clear zone, the farthest from `taken` (target px). */
export function placeApart(fx: AnyFxContext, clear: number, taken: [number, number][]): [number, number] {
  const { w, h } = fx.target;
  const points = Array.from({ length: CANDIDATES }, (): [number, number] => {
    const [u, v] = placeOutside(fx.random, clear);

    return [u * w, v * h];
  });

  return points.reduce((best, point) => (gapTo(point, taken) > gapTo(best, taken) ? point : best));
}

function ramp(fx: AnyFxContext, seconds: number, life: number): number {
  return Math.max(MIN_RAMP_FRAMES / fx.frame.fps, Math.min(seconds, life / 3));
}

// One disc of the bokeh field: tier `tier`, drifting at the tier's share of the near speed.
function disc(fx: FxContext<'bokeh'>, tier: number, drift: Drift, at: [number, number]): Particle {
  const short = Math.min(fx.target.w, fx.target.h);
  const span = fx.end - fx.at;
  const speed = drift.speed * (1 - (fx.graphic.depth ?? 0.5) * (tier / 2) * 1.7);
  const vx = speed * Math.cos(drift.heading);
  const vy = speed * Math.sin(drift.heading);
  const sway = short * (0.01 + fx.random() * 0.015);
  const from = fx.at + fx.random() * Math.min(0.6, span * 0.15);

  return {
    tier,
    // Centred on the sampled point halfway through the window.
    x: at[0] - (vx * span) / 2,
    y: at[1] - (vy * span) / 2,
    vx,
    vy,
    sx: -Math.sin(drift.heading) * sway,
    sy: Math.cos(drift.heading) * sway,
    omega: (2 * Math.PI) / (5 + fx.random() * 4),
    phase: fx.random() * 2 * Math.PI,
    alpha: fx.peak * BOKEH_TIERS[tier].alpha * (0.85 + fx.random() * 0.15),
    from,
    to: fx.end,
    ramp: ramp(fx, 0.9 + fx.random() * 0.5, fx.end - from),
  };
}

function tierOf(index: number, count: number): number {
  const near = Math.max(1, Math.round(count * BOKEH_TIERS[0].share));
  const mid = Math.max(1, Math.round(count * BOKEH_TIERS[1].share));

  if (index < near) return 0;

  return index < near + mid ? 1 : 2;
}

/** The bokeh field: context defaults drawn in a fixed order, then the discs, near tier first. */
export function bokehField(fx: FxContext<'bokeh'>): ParticleField {
  const g = fx.graphic;
  const short = Math.min(fx.target.w, fx.target.h);
  const count = g.count ?? 6 + Math.floor(fx.random() * 5);
  const radius = (g.size ?? 0.1 + fx.random() * 0.05) * short;
  const softness = g.softness ?? 0.25 + fx.random() * 0.2;
  const heading = g.drift ?? -90 + (fx.random() * 2 - 1) * 70;
  const drift = { heading: (heading * Math.PI) / 180, speed: (g.speed ?? 0.035) * short * energyScale(fx) };
  const tiers = BOKEH_TIERS.map(({ size, soft }): SpriteSpec => {
    const r = Math.max(2, Math.round(radius * size * 2) / 2);
    const halo = Math.max(0.5, Math.round(r * Math.min(1, softness * soft) * 2) / 2);

    return {
      kind: 'bokeh',
      w: 2 * Math.ceil(r + 2 * halo + 1),
      h: 2 * Math.ceil(r + 2 * halo + 1),
      radius: r,
      halo,
      ...spriteColor(fx),
    };
  });
  const taken: [number, number][] = [];
  const particles = Array.from({ length: count }, (_, i) => {
    const point = placeApart(fx, g.clear ?? 0.3, taken);

    taken.push(point);

    return disc(fx, tierOf(i, count), drift, point);
  });

  return { tiers, particles, dither: true };
}

// One life of a mote: a random start (lives overlap the window edges and are clipped to it).
function mote(fx: FxContext<'dust'>, drift: Drift, life: number): Particle {
  const { w, h } = fx.target;
  const short = Math.min(w, h);
  const span = fx.end - fx.at;
  const start = life >= span ? fx.at : fx.at - life / 2 + fx.random() * (span + life / 2);
  const [from, to] = [Math.max(fx.at, start), Math.min(fx.end, start + life)];
  const heading = drift.heading + ((fx.random() * 2 - 1) * 25 * Math.PI) / 180;
  const speed = drift.speed * (0.5 + fx.random());
  const [u, v] = placeOutside(fx.random, fx.graphic.clear ?? 0.2);
  const sway = short * (0.003 + fx.random() * 0.007);
  const tier = fx.random() < 0.6 ? 0 : 1;

  return {
    tier,
    x: u * w - (speed * Math.cos(heading) * span) / 2,
    y: v * h - (speed * Math.sin(heading) * span) / 2,
    vx: speed * Math.cos(heading),
    vy: speed * Math.sin(heading),
    sx: -Math.sin(heading) * sway,
    sy: Math.cos(heading) * sway,
    omega: (2 * Math.PI) / (3 + fx.random() * 4),
    phase: fx.random() * 2 * Math.PI,
    alpha: fx.peak * (0.8 + fx.random() * 0.2),
    from,
    to,
    ramp: ramp(fx, from === fx.at ? 0.6 : 0.25 + fx.random() * 0.35, to - from),
  };
}

/** The dust field: two mote sizes (odd sprites, so a mote's peak sits on one pixel) and seeded lives. */
export function dustField(fx: FxContext<'dust'>): ParticleField {
  const g = fx.graphic;
  const short = Math.min(fx.target.w, fx.target.h);
  const span = fx.end - fx.at;
  const count = g.count ?? 16 + Math.floor(fx.random() * 9);
  const heading = g.drift ?? (fx.random() < 0.5 ? 90 : -90) + (fx.random() * 2 - 1) * 35;
  const drift = { heading: (heading * Math.PI) / 180, speed: (g.speed ?? 0.012) * short * energyScale(fx) };
  const life = span * (1 - (2 / 3) * (g.flicker ?? 0.5));
  const lives = Math.min(MAX_LIVES, Math.ceil((count * span) / life));
  const diameter = ((g.size ?? 2.5) * Math.min(fx.frame.width, fx.frame.height)) / 720;
  const tiers = [0.75, 1.25].map((share): SpriteSpec => {
    const sigma = Math.max(0.4, Math.round(((diameter * share) / 2.355) * 100) / 100);
    const side = 2 * Math.ceil(3 * sigma) + 1;

    return { kind: 'disc', w: side, h: side, sigma, ...spriteColor(fx) };
  });
  const steady = g.flicker === 0;
  const particles = Array.from({ length: lives }, () => {
    const jitter = 0.75 + fx.random() * 0.5;

    return mote(fx, drift, steady ? span : life * jitter);
  });

  return {
    tiers,
    particles: particles.filter((p) => p.to - p.from > (2 * MIN_RAMP_FRAMES) / fx.frame.fps),
    dither: false,
  };
}

// Overlay position of a particle's sprite (top-left, target px) at section time t.
function position(fx: AnyFxContext, p: Particle, side: number): { x: string; y: string } {
  const since = `(t-${fmt(fx.at)})`;
  const wave = `sin(${fmt(p.omega)}*${since}+${fmt(p.phase)})`;

  return {
    x: `${fmt(p.x - side / 2)}+${fmt(p.vx)}*${since}+${fmt(p.sx)}*${wave}`,
    y: `${fmt(p.y - side / 2)}+${fmt(p.vy)}*${since}+${fmt(p.sy)}*${wave}`,
  };
}

function particleFilters(fx: AnyFxContext, p: Particle, dither: boolean): Filter[] {
  const [, ...grain] = ditherFilters(fx);

  return [
    { type: 'lutyuv', value: `a='val*${fmt(p.alpha)}'` },
    { type: 'fade', value: `t=in:st=${fmt(p.from)}:d=${fmt(p.ramp)}:alpha=1` },
    { type: 'fade', value: `t=out:st=${fmt(p.to - p.ramp)}:d=${fmt(p.ramp)}:alpha=1` },
    ...(dither ? grain : []),
  ];
}

/** The field as light layers: one sprite input per tier, split per particle; null when sprites are unavailable. */
export function particleLayers(fx: AnyFxContext, field: ParticleField): FxLayer[] | null {
  const p = fx.prefix;
  const labels = field.tiers.map((spec, i) => fx.sprite(`p${i}`, spec));

  if (labels.some((label) => label === null)) return null;

  const members = field.tiers.map((_, i) => field.particles.flatMap((particle, j) => (particle.tier === i ? [j] : [])));
  const splits: FilterGraphChain[] = members.flatMap((list, i) =>
    list.length === 0
      ? []
      : [
          {
            inputs: [labels[i] as string],
            filters: [
              { type: 'format', value: 'yuva444p' },
              { type: 'split', value: String(list.length) },
            ],
            outputs: list.map((j) => `${p}s${j}`),
          },
        ]
  );

  return field.particles.map((particle, j) => ({
    chains: [
      ...(j === 0 ? splits : []),
      { inputs: [`${p}s${j}`], filters: particleFilters(fx, particle, field.dither), outputs: [`${p}q${j}`] },
    ],
    label: `${p}q${j}`,
    ...position(fx, particle, field.tiers[particle.tier].w),
  }));
}

export const BOKEH: FxEffect<'bokeh'> = {
  lower: (fx) => (fx.reduced ? [] : particleLayers(fx, bokehField(fx))),
};

export const DUST: FxEffect<'dust'> = {
  lower: (fx) => (fx.reduced ? [] : particleLayers(fx, dustField(fx))),
};
