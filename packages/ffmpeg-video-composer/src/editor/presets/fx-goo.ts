// fx "goo": liquid blobs that move, stretch, split into droplets and merge back, with smooth gooey necks.
// Fields: schemas/fx-liquid.schemas.ts.
//
// The classic gooey look is blur, then a hard alpha threshold. Here every blob is ONE compile-time gaussian
// disc sprite (fx-sprites `disc`, white, alpha = the gaussian), scaled per frame to its radius track and laid
// at its x/y tracks (overlay expressions) on a black canvas the size of the effect's bounding region (not
// the frame). White over black composites as a union, 1 − Π(1 − aᵢ), so where two discs' falloffs meet the
// field rises above the threshold between them: they fuse with a neck before they touch, and pinch off
// when they part. ONE lutyuv then cuts the canvas at the threshold with a ~1 px ramp (an anti-aliased
// edge, not a binary step), and that mask is the alpha of a solid fill. A blob's radius R is where its own
// gaussian crosses the threshold θ: σ = R / √(2 ln(1/θ)); `goo` moves θ (0.3..0.7), which sets how far apart
// blobs still fuse (≈ 2.4R..3R between centres).
//
// Without `blobs`, a seeded choreography: the main blob pops in (one overshoot, ≤ 8 %), 1–4 droplets
// stretch out of it along an axis and settle apart (the split ease overshoots ~4 %), hold, run back and
// merge on the same frame, the whole blob holds, then shrinks away. Reduced motion: one still blob faded
// in and out. Filters: format, fps, trim, color, setpts, overlay, scale (eval=frame), lutyuv, alphamerge,
// fade, colorchannelmixer: all on-device.

import type { Filter, FilterGraphChain } from '@/core/types';
import { fmt } from '@/core/motion/hermite';
import { trackExpr } from '@/core/motion/tracks';
import { shiftTo, sourceTiming, type FxContext, type FxEffect, type FxLayer } from './fx-kit';
import {
  alphaScale,
  centredAt,
  drawIn,
  even,
  fadeIn,
  fadeOut,
  scaleTo,
  sizeExpr,
  spriteStream,
  themeColors,
} from './fx-marks';
import { bounds, gooPlan, type GooPlan, type Track } from './fx-goo-plan';

export { blobsAt, gooPlan, gooThreshold, GOO_POP_EASE, type GooPlan } from './fx-goo-plan';

type Ctx = FxContext<'goo'>;

/** Luma of the composited canvas: black and white in limited range. */
const [BLACK, WHITE] = [16, 235];
/** The sprite holds its gaussian out to this many σ (the field is < 1 % beyond). */
const SPRITE_SIGMAS = 3.2;
/** The sprite is drawn this many times smaller than it shows, then scaled up. */
const SPRITE_REDUCTION = 4;

function expr(track: Track, offset: number): string | number {
  if (!track.keys) return Math.round((track.base - offset) * 100) / 100;

  return `(${trackExpr(track.keys, track.base)})-${fmt(offset)}`;
}

// The blob's sprite branch: scaled to its radius track, or once to a static radius below the sprite's.
function sizing(track: Track, plan: GooPlan, side: number): Filter[] {
  if (track.keys) return [scaleTo(sizeExpr(side, `max(0,${trackExpr(track.keys, track.base)})/${plan.radius}`))];

  const size = even((side * track.base) / plan.radius);

  return [{ type: 'scale', value: `${size}:${size}` }];
}

function fillOf(fx: Ctx): string {
  if (fx.graphic.color) return fx.color;

  const accent = themeColors(fx, ['accent'])[0];

  return accent ? `0x${accent.toUpperCase()}` : fx.color;
}

function lower(fx: Ctx): FxLayer[] | null {
  const target = { ...fx.target };
  const plan = gooPlan(fx.graphic, target, { ...fx, reduced: fx.reduced });
  const region = drawIn(fx, bounds(plan, target));

  if (!region || (!fx.has('scale') && plan.blobs.some((blob) => blob.r.keys))) return null;

  const p = fx.prefix;
  const sigma = plan.radius / Math.sqrt(2 * Math.log(1 / plan.threshold));
  const side = even(2 * SPRITE_SIGMAS * sigma);
  // A gaussian is smooth: the sprite is drawn at a quarter of its size and scaled up per blob, which costs
  // a sixteenth of scaling a full-size sprite every frame.
  const small = Math.max(16, even(side / SPRITE_REDUCTION));
  const stream = spriteStream(
    fx,
    'blob',
    { kind: 'disc', w: small, h: small, sigma: Math.round((sigma * small * 100) / side) / 100 },
    plan.blobs.length
  );

  if (!stream) return null;

  const [ox, oy] = [region.x - target.x, region.y - target.y];
  const sized = plan.blobs.map((blob, i): FilterGraphChain | null => {
    const filters = sizing(blob.r, plan, side);

    return filters.length > 0 ? { inputs: [stream.labels[i]], filters, outputs: [`${p}b${i}`] } : null;
  });
  const canvas: FilterGraphChain = {
    filters: [
      { type: 'color', value: `c=black:s=${region.w}x${region.h}:${sourceTiming(fx)}` },
      shiftTo(fx),
      { type: 'format', value: 'yuv420p' },
    ],
    outputs: [`${p}c0`],
  };
  const laid = plan.blobs.map((blob, i): FilterGraphChain => {
    const at = centredAt(expr(blob.x, ox), expr(blob.y, oy));

    return {
      inputs: [`${p}c${i}`, sized[i] ? `${p}b${i}` : stream.labels[i]],
      filters: [{ type: 'overlay', value: `x='${at.x}':y='${at.y}'` }],
      outputs: [`${p}c${i + 1}`],
    };
  });
  // The edge gradient of a lone blob at the sprite radius, in canvas levels per px: the ramp spans ~1 px.
  const ramp = Math.min(
    24,
    Math.max(1, ((WHITE - BLACK) * plan.threshold * 2 * Math.log(1 / plan.threshold)) / plan.radius)
  );
  const level = BLACK + (WHITE - BLACK) * plan.threshold;
  const half = (fx.end - fx.at) / 2;
  const fades = fx.reduced ? [fadeIn(fx, fx.at, half), ...fadeOut(fx, fx.at + half, half)] : [];

  return [
    {
      chains: [
        ...stream.chains,
        ...sized.filter((chain): chain is FilterGraphChain => chain !== null),
        canvas,
        ...laid,
        {
          inputs: [`${p}c${plan.blobs.length}`],
          filters: [
            { type: 'lutyuv', value: `y='255*clip((val-${fmt(level)})/${fmt(Math.round(ramp * 10) / 10)}+0.5,0,1)'` },
            { type: 'format', value: 'gray' },
          ],
          outputs: [`${p}k`],
        },
        {
          filters: [
            { type: 'color', value: `c=${fillOf(fx)}:s=${region.w}x${region.h}:${sourceTiming(fx)}` },
            shiftTo(fx),
          ],
          outputs: [`${p}f`],
        },
        {
          inputs: [`${p}f`, `${p}k`],
          filters: [{ type: 'alphamerge' }, ...alphaScale(fx.peak), ...fades],
          outputs: [`${p}goo`],
        },
      ],
      label: `${p}goo`,
      x: '0',
      y: '0',
    },
  ];
}

export const GOO: FxEffect<'goo'> = { lower };
