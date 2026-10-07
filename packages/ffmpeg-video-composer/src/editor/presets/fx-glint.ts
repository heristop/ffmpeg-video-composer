// fx "glint": four-point star glints that twinkle once on their target, or small lights orbiting it (the
// former "spec orbit"). Fields: schemas/fx-celebrate.schemas.ts.
//
// Every star is the same compile-time `star` sprite (gaussian core plus 6:1 cross flares), rendered once
// at the largest on-screen size and only scaled DOWN per frame: it turns by `spin` (rotate, on the fixed
// sprite size), then scales 0 → 1 → 0 (up on the pass ease, a juicy overshoot kept under the sprite size;
// down on an ease-in), with 4-frame alpha ramps at both ends. Stars are staggered so the whole pass stays
// inside `duration`. Orbit: `count` lights travel around the target's edge (an ellipse through the
// middle of its sides) with a trail of fading gaussian ghosts. The region is the target grown by half a
// star, so a corner glint is never cut. Reduced motion: the stars at rest, half size, faded in and out.

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
  type Region,
} from './fx-marks';
import { glintPasses, glintSpots, orbitLayers, OVERSHOOT, starSpec } from './fx-glint-paths';

type Ctx = FxContext<'glint'>;

/** Share of a star's life spent growing (the rest shrinks). */
export const GROW = 0.45;
export const SHRINK_EASE = 'cubic-bezier(0.4, 0, 1, 1)';

export interface Star {
  /** Centre in region px. */
  cx: number;
  cy: number;
  /** Size as a share of the sprite. */
  scale: number;
  start: number;
  life: number;
}

export interface GlintPlan {
  region: Region;
  /** The star sprite side (px) and spec. */
  side: number;
  spec: SpriteSpec;
  stars: Star[];
}

// Sizes, positions and timing; context defaults drawn in a fixed order: count, sizes, spots, order.
export function planOf(fx: Ctx): GlintPlan | null {
  const g = fx.graphic;
  const k = frameScale(fx);
  const { x, y, w, h } = fx.target;
  const small = Math.min(w, h) < 220 * k;
  const count = g.points?.length ?? g.count ?? (small ? 3 : 3 + Math.floor(fx.random() * 3));
  const sizes = Array.from({ length: count }, () => {
    const jitter = fx.random();

    return (g.size ?? 36 + jitter * 16) * k;
  });
  const spec = starSpec(Math.max(...sizes), spriteHex(fx.color) ?? 'ffffff');
  const pad = spec.w / 2;
  const region = drawIn(fx, { x: x - pad, y: y - pad, w: w + 2 * pad, h: h + 2 * pad });

  if (!region) return null;

  const spots = glintSpots(g.path ?? 'scatter', count, fx.random, g.points);
  const stagger = count > 1 ? Math.min(g.stagger ?? 0.12, (fx.duration * 0.6) / (count - 1)) : 0;
  const life = fx.duration - (count - 1) * stagger;
  const stars = glintPasses(fx, count).flatMap((t0) =>
    spots.map((spot, i) => ({
      cx: Math.round(x + spot.x * w - region.x),
      cy: Math.round(y + spot.y * h - region.y),
      scale: sizes[i] / Math.max(...sizes),
      start: t0 + spot.order * stagger,
      life,
    }))
  );

  return { region, side: spec.w, spec, stars };
}

function twinkle(fx: Ctx, star: Star): string {
  const up = easedProgressExpr(parseEasing(fx.ease), { delay: star.start, duration: star.life * GROW });
  const down = easedProgressExpr(parseEasing(SHRINK_EASE), {
    delay: star.start + star.life * GROW,
    duration: star.life * (1 - GROW),
  });

  return `${fmt(star.scale / OVERSHOOT)}*((${up})-(${down}))`;
}

function starFilters(fx: Ctx, plan: GlintPlan, star: Star): Filter[] {
  const spin = ((fx.graphic.spin ?? 15) * Math.PI) / 180;
  const ramp = Math.min(rampOf(fx), star.life / 4);
  const turn: Filter[] =
    spin !== 0 && fx.has('rotate')
      ? [{ type: 'rotate', value: `a='${fmt(spin)}*clip((t-${fmt(star.start)})/${fmt(star.life)},0,1)':c=none` }]
      : [];

  return [
    { type: 'trim', value: `start=${fmt(star.start)}:end=${fmt(star.start + star.life)}` },
    fadeIn(fx, star.start, ramp),
    ...fadeOut(fx, star.start + star.life - ramp, ramp),
    ...turn,
    scaleTo(sizeExpr(plan.side, twinkle(fx, star))),
  ];
}

function stars(fx: Ctx, plan: GlintPlan): FxLayer[] | null {
  const stream = spriteStream(fx, 'star', plan.spec, plan.stars.length, alphaScale(fx.peak));

  if (!stream) return null;

  const layers = plan.stars.map((star, i): FxLayer => {
    const label = `${fx.prefix}st${i}`;

    return {
      chains: [{ inputs: [stream.labels[i]], filters: starFilters(fx, plan, star), outputs: [label] }],
      label,
      ...centredAt(star.cx, star.cy),
    };
  });

  return [{ ...layers[0], chains: [...stream.chains, ...layers[0].chains] }, ...layers.slice(1)];
}

// Reduced motion: every star of the first pass at rest, half size, faded in then out over the window.
function still(fx: Ctx, plan: GlintPlan): FxLayer[] | null {
  const half = (fx.end - fx.at) / 2;
  const first = plan.stars.filter((star) => star.start < fx.at + fx.duration);
  const stream = spriteStream(fx, 'star', plan.spec, first.length, [
    ...alphaScale(fx.peak),
    fadeIn(fx, fx.at, half),
    ...fadeOut(fx, fx.at + half, half),
  ]);

  if (!stream) return null;

  return first.map((star, i): FxLayer => {
    const side = even(plan.side * star.scale * 0.5);
    const label = `${fx.prefix}st${i}`;
    const chains = [
      ...(i === 0 ? stream.chains : []),
      { inputs: [stream.labels[i]], filters: [{ type: 'scale', value: `${side}:${side}` }], outputs: [label] },
    ];

    return { chains, label, ...centredAt(star.cx, star.cy) };
  });
}

function lower(fx: Ctx): FxLayer[] | null {
  if (!fx.has('scale')) return null;

  if (fx.graphic.path === 'orbit' && !fx.graphic.points) return orbitLayers(fx);

  const plan = planOf(fx);

  if (!plan || plan.stars.length === 0) return null;

  return fx.reduced ? still(fx, plan) : stars(fx, plan);
}

export const GLINT: FxEffect<'glint'> = { lower };
