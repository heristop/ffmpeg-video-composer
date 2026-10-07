// Gradient / texture / shimmer-filled kinetic text, lowered as a mask (docs: kinetic[].fill).
//
// The block's units are drawn twice with identical per-unit expressions, so the fill keeps every
// unit's timing: once white on a black frame (the MASK), once on the section for whatever must sit
// under the fill (highlight markers, shadow/outline effects with an invisible face, caret/decoys).
// The fill source — a `gradients` sweep, a looped texture image or a flat colour, optionally crossed by
// a soft shimmer band — takes the mask's luma as its alpha (alphamerge) and is laid over the section:
//
//   [in] base-only draws [b]; color=black,format=gray, white units, lutyuv stretch [m];
//   <fill source>[,shimmer overlay] [f]; [f][m]alphamerge [t]; [b][t]overlay=0:0 → out
//
// drawtext on gray draws limited-range luma (16–235) on some builds and full-range on others; the
// lutyuv stretch maps both to an exact 0–255 alpha (0 and 255 land on 0 and 255 either way).
// Everything is a pure function of the block and the frame: deterministic, no seed needed.

import type { Filter, FilterGraphChain } from '@/core/types';
import type { KineticFill } from '../../schemas/kinetic.schemas';
import { fmt } from '@/core/motion/hermite';

export interface FillBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FillEnv {
  width: number;
  height: number;
  fps: number;
  /** Section length in seconds (0 = unbounded sources, cut by the output's own `-t`). */
  duration: number;
  /** Pad-name prefix unique within the section graph, `[A-Za-z0-9_]`. */
  prefix: string;
  /** Registers a texture image as an extra `-i`, returning its `input:<key>` label (null: unavailable). */
  texture?: (url: string) => string | null;
  /** Colour tokens resolved (theme/variables) and checked safe for a filter option. */
  color: (color: string) => string;
}

export interface FillParts {
  /** Drawn on the section before the filled text is laid over it. */
  base: Filter[];
  /** White drawtext units (same expressions as the visible ones). */
  mask: Filter[];
  /** The text block's resting bounding box, output px. */
  box: FillBox;
  /** When the last unit has landed, seconds: the default first shimmer pass. */
  landed: number;
  /** The block's own colour, the flat fill under a sweep-only fill. */
  solid: string;
}

const STRETCH = "y='clip((val-16)*255/219,0,255)'";
const SWEEP_DURATION = 1.2;
const SWEEP_COLOR = '#FFFFFF@0.7';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max);
}

// A source's timing tail: `:r=<fps>[:d=<duration>]`.
function timing(env: FillEnv): string {
  return `r=${env.fps}${env.duration > 0 ? `:d=${fmt(env.duration)}` : ''}`;
}

/**
 * gradients endpoints for a CSS angle (0 bottom→top, 90 left→right) across the block box, clamped to
 * the frame (the gradients source re-randomises coordinates outside it).
 */
export function gradientEndpoints(angle: number, box: FillBox, env: Pick<FillEnv, 'width' | 'height'>): string {
  const theta = (((angle % 360) + 360) % 360) * (Math.PI / 180);
  const dx = Math.sin(theta);
  const dy = -Math.cos(theta);
  const reach = Math.min(
    Math.abs(dx) < 1e-9 ? Infinity : box.w / 2 / Math.abs(dx),
    Math.abs(dy) < 1e-9 ? Infinity : box.h / 2 / Math.abs(dy)
  );
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const [x0, x1] = [cx - dx * reach, cx + dx * reach].map((value) => clamp(value, 0, env.width - 1));
  const [y0, y1] = [cy - dy * reach, cy + dy * reach].map((value) => clamp(value, 0, env.height - 1));

  return `x0=${x0}:y0=${y0}:x1=${x1}:y1=${y1}`;
}

function gradientSource(gradient: NonNullable<KineticFill['gradient']>, box: FillBox, env: FillEnv): Filter {
  const stops = 'stops' in gradient ? gradient.stops : [gradient.from, gradient.to];
  const colors = stops.map((stop, index) => `c${index}=${env.color(stop)}`).join(':');
  const ends = gradientEndpoints(gradient.angle ?? 90, box, env);
  // speed: the option's minimum, not 0 (older builds reject 0); the default 0.01 would slowly rotate it.
  const value = `s=${env.width}x${env.height}:${colors}:nb_colors=${stops.length}:${ends}:speed=0.00001:${timing(env)}`;

  return { type: 'gradients', value };
}

// The fill before any shimmer: texture > gradient > the block's flat colour.
function fillSource(fill: KineticFill, parts: FillParts, env: FillEnv, out: string): FilterGraphChain {
  const texture = fill.texture ? (env.texture?.(fill.texture) ?? null) : null;
  const size = `${env.width}:${env.height}`;

  if (texture) {
    const filters: Filter[] = [
      { type: 'scale', value: `${size}:force_original_aspect_ratio=increase` },
      { type: 'crop', value: size },
      { type: 'setsar', value: '1' },
      { type: 'fps', value: env.fps },
      { type: 'format', value: 'rgba' },
    ];

    return { inputs: [texture], filters, outputs: [out] };
  }

  if (fill.gradient) return { filters: [gradientSource(fill.gradient, parts.box, env)], outputs: [out] };

  const solid = `c=${env.color(parts.solid)}:s=${env.width}x${env.height}:${timing(env)}`;

  return {
    filters: [
      { type: 'color', value: solid },
      { type: 'format', value: 'rgba' },
    ],
    outputs: [out],
  };
}

/** The shimmer band's x over time: off-frame left until its pass, smoothstep across, off-frame right. */
export function sweepX(sweep: NonNullable<KineticFill['sweep']>, landed: number, band: number, width: number): string {
  const delay = fmt(sweep.delay ?? landed);
  const local = sweep.every ? `mod(t-${delay},${fmt(sweep.every)})` : `(t-${delay})`;
  const p = `clip(${local}/${fmt(sweep.duration ?? SWEEP_DURATION)},0,1)`;

  return `if(lt(t,${delay}),-${fmt(band)},-${fmt(band)}+${fmt(width + band)}*${p}*${p}*(3-2*${p}))`;
}

function shimmerChains(fill: KineticFill, parts: FillParts, env: FillEnv, from: string, out: string) {
  const sweep = fill.sweep;

  if (!sweep) return null;

  const band = Math.max(2, Math.round(sweep.width ?? parts.box.h * 0.6));
  const color = env.color(sweep.color ?? SWEEP_COLOR);
  const clear = `${color.split('@')[0]}@0`;
  const source = `s=${band}x${env.height}:c0=${clear}:c1=${color}:c2=${clear}:nb_colors=3:x0=0:y0=0:x1=${band - 1}:y1=0:speed=0.00001:${timing(env)}`;
  const x = sweepX(sweep, parts.landed, band, env.width);

  return [
    { filters: [{ type: 'gradients', value: source }], outputs: [`${env.prefix}s`] },
    {
      inputs: [from, `${env.prefix}s`],
      filters: [{ type: 'overlay', value: `x='${x}':y=0:format=rgb` }],
      outputs: [out],
    },
  ];
}

/** The filled block as one engine sub-graph filter, spliced where the block's drawtexts would sit. */
export function fillGraph(fill: KineticFill, parts: FillParts, env: FillEnv): Filter {
  const p = env.prefix;
  const mask: Filter[] = [
    { type: 'color', value: `c=black:s=${env.width}x${env.height}:${timing(env)}` },
    { type: 'format', value: 'gray' },
    ...parts.mask,
    { type: 'lutyuv', value: STRETCH },
  ];
  const shimmer = shimmerChains(fill, parts, env, `${p}f0`, `${p}f`);
  const source = fillSource(fill, parts, env, shimmer ? `${p}f0` : `${p}f`);
  const graph: FilterGraphChain[] = [
    { filters: parts.base.length > 0 ? parts.base : [{ type: 'null' }], outputs: [`${p}b`] },
    { filters: mask, outputs: [`${p}m`] },
    source,
    ...(shimmer ?? []),
    { inputs: [`${p}f`, `${p}m`], filters: [{ type: 'alphamerge' }], outputs: [`${p}t`] },
    { inputs: [`${p}b`, `${p}t`], filters: [{ type: 'overlay', value: '0:0' }] },
  ];

  return { type: 'graph', graph };
}
