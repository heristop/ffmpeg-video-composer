// The toolkit fx primitives lower with (editor/presets/fx.ts dispatches to them). A primitive builds one or
// more LIGHT LAYERS (RGBA sources moving over the target) and `lightInTarget` does the rest the same way
// for every primitive: the section frame is split, the target region is cropped (bounded to the effect
// window with trim, so nothing runs after it), the layers are laid over that region, the result is clipped
// to the target shape (rounded sprite mask or the kinetic glyph mask, via alphamerge) and composited back
// with `enable` limited to the window. Outside the window and outside the target the frame is untouched,
// bit for bit (the frame is pinned opaque before the split: see OPAQUE). Filters: split, trim, crop,
// overlay, alphamerge, color, format, setpts, noise, lutyuv, fade
// (all on the on-device allowlist).

import type { Filter, FilterGraphChain } from '@/core/types';
import { parseEasing, type EasingSpec } from '@/core/motion/easing';
import { easedProgressExpr, fmt } from '@/core/motion/hermite';
import type { FxEffectName, FxGraphicOf } from '../../schemas/fx.schemas';
import { snapToFrame, type FxTargetRect } from './fx-target';
import type { SpriteSpec } from './fx-sprites';

/** Everything a primitive needs, resolved by the dispatcher (defaults already derived from the context). */
export interface FxContext<N extends FxEffectName> {
  graphic: FxGraphicOf<N>;
  target: FxTargetRect;
  frame: { width: number; height: number; fps: number };
  /** First pass start, on the frame grid. */
  at: number;
  /** One pass, a whole number of frames. */
  duration: number;
  passes: number;
  /** Seconds between pass starts. */
  every: number;
  /** When the last pass ends (or `until`), on the frame grid. */
  end: number;
  ease: EasingSpec;
  /** The light colour, resolved (theme tokens, variables), without alpha. */
  color: string;
  /** global.theme as authored (resolveTheme gives its palette for colour defaults). */
  theme?: unknown;
  /** Peak alpha: intensity under the primitive's ceiling. */
  peak: number;
  /** global.motion.energy (0 = reduced motion). */
  energy: number;
  reduced: boolean;
  /** Element seed (global.seed, path and the element's own `seed`). */
  seed: number;
  /** Seeded stream for context defaults; draw in a fixed order. */
  random: () => number;
  /** Pad-name prefix unique in the section graph. */
  prefix: string;
  has: (filter: string) => boolean;
  /** Registers a compile-time sprite as a looped still input; its sub-graph label, or null when unavailable. */
  sprite: (key: string, spec: SpriteSpec) => string | null;
}

/** The context of any primitive (the kit's helpers take every one). */
export type AnyFxContext = FxContext<FxEffectName>;

/** A primitive's lowering: the light layers over its target, or null to skip (after a warning). */
export interface FxEffect<N extends FxEffectName> {
  // Method syntax on purpose: the registry holds each primitive's FxEffect<N> as FxEffect<FxEffectName>.
  lower(fx: FxContext<N>): FxLayer[] | null;
}

/** One light layer: chains producing `label` (target-sized coordinates), laid over the region at x/y. */
export interface FxLayer {
  chains: FilterGraphChain[];
  label: string;
  /** Overlay position expressions in target pixels (evaluated per frame, `t` = section time). */
  x: string;
  y: string;
  /**
   * Labels the kit feeds with copies of the picture under the effect (the region, cropped and bounded to
   * the window, before any light), for light built from the frame itself: halation, grain, a leak that
   * spares the shadows. Each label is consumed once by the layer's chains.
   */
  taps?: string[];
}

const STRETCH = "y='clip((val-16)*255/219,0,255)'";
/** Dither amplitude on the light's alpha plane, and the floor that keeps empty pixels exactly empty. */
const DITHER = { strength: 3, floor: 3 };

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Makes `box` (frame px) the region the light is drawn in and composited over (marks that leave
 * their target, a glow AROUND a card): no mask, even pixels, inside the
 * frame. Returns the snapped region, or null when it lies outside the frame.
 */
export function drawIn(fx: AnyFxContext, box: Region): Region | null {
  const region = snapToFrame(box, fx.frame.width, fx.frame.height);

  if (!region) return null;

  fx.target = { ...region, radius: 0, mask: 'none' };

  return region;
}

/** The whole frame as the region (particles that may fly anywhere). */
export function drawInFrame(fx: AnyFxContext): Region {
  return drawIn(fx, { x: 0, y: 0, w: fx.frame.width, h: fx.frame.height }) as Region;
}

/** A lavfi source's timing for the effect window: `r=<fps>:d=<span>` (pair it with `shiftTo`). */
export function sourceTiming(fx: AnyFxContext): string {
  return `r=${fx.frame.fps}:d=${fmt(fx.end - fx.at)}`;
}

/**
 * The element's seed for a `gradients` source. FFmpeg seeds it from the clock by default (seed -1) and
 * draws from it whenever an endpoint falls outside the source; pinned, the source is a pure function of
 * its options even then.
 */
export function gradientSeed(fx: AnyFxContext): string {
  return `seed=${fx.seed % 2147483647}`;
}

/** Moves a source that starts at 0 to the effect window, so `t` in later filters is section time. */
export function shiftTo(fx: AnyFxContext): Filter {
  return { type: 'setpts', value: `PTS+${fmt(fx.at)}/TB` };
}

/**
 * Seeded dither on the light's ALPHA (what a light layer is quantised by), inside the light only: the floor
 * zeroes the noise where the layer is empty. ±1 alpha step (well under one code value once composited)
 * and STATIC: the pattern rides with the layer instead of fizzing every frame, so it breaks the 8-bit
 * steps of a slow falloff without adding texture an encoder smears into blotches. Converts to yuva444p.
 */
export function ditherFilters(fx: AnyFxContext): Filter[] {
  return [
    { type: 'format', value: 'yuva444p' },
    { type: 'noise', value: `c3s=${DITHER.strength}:c3f=u:all_seed=${fx.seed % 2147483647}` },
    { type: 'lutyuv', value: `a='if(lt(val,${DITHER.floor}),0,val)'` },
  ];
}

/** Eased 0→1 progress of the current pass at section time `t` (passes repeat `every` seconds). */
export function passProgress(fx: AnyFxContext): string {
  const time = fx.passes > 1 ? `(${fmt(fx.at)}+mod(t-${fmt(fx.at)},${fmt(fx.every)}))` : 't';

  return easedProgressExpr(parseEasing(fx.ease), { delay: fx.at, duration: fx.duration }, time);
}

/** The reduced-motion stand-in: a still highlight of `alpha` over the whole target, faded in then out. */
export function staticHighlight(fx: AnyFxContext, alpha: number): FxLayer {
  const p = fx.prefix;
  const half = (fx.end - fx.at) / 2;
  const { w, h } = fx.target;
  const source = `c=${fx.color}@${fmt(alpha)}:s=${w}x${h}:${sourceTiming(fx)}`;
  const filters: Filter[] = [
    { type: 'color', value: source },
    shiftTo(fx),
    { type: 'format', value: 'yuva444p' },
    { type: 'fade', value: `t=in:st=${fmt(fx.at)}:d=${fmt(half)}:alpha=1` },
    { type: 'fade', value: `t=out:st=${fmt(fx.at + half)}:d=${fmt(half)}:alpha=1` },
  ];

  return { chains: [{ filters, outputs: [`${p}hl`] }], label: `${p}hl`, x: '0', y: '0' };
}

// The target's shape as a mask chain, or null when the target is a plain rectangle (the crop clips it).
function maskChains(fx: AnyFxContext, from: string, out: string): FilterGraphChain[] | null | false {
  const { x, y, w, h, radius, mask } = fx.target;
  const p = fx.prefix;

  if (mask === 'none') return null;

  if (mask === 'rounded') {
    const label = fx.sprite('mask', { kind: 'mask', w, h, radius });

    return label ? [{ inputs: [from, label], filters: [{ type: 'alphamerge' }], outputs: [out] }] : false;
  }

  const canvas = `c=black:s=${fx.frame.width}x${fx.frame.height}:r=${fx.frame.fps}:d=${fmt(fx.end)}`;
  const glyphs: Filter[] = [
    { type: 'color', value: canvas },
    { type: 'format', value: 'gray' },
    ...(fx.target.textMask ?? []),
    { type: 'lutyuv', value: STRETCH },
    { type: 'crop', value: `${w}:${h}:${x}:${y}` },
  ];

  return [
    { filters: glyphs, outputs: [`${p}k`] },
    { inputs: [from, `${p}k`], filters: [{ type: 'alphamerge' }], outputs: [out] },
  ];
}

/**
 * The section frame enters the sub-graph opaque. Without the pin, alphamerge's need for alpha propagates up
 * through overlay/crop/split and the whole section negotiates yuva420p; text drawn before the effect then
 * leaves partial alpha in it, and FFmpeg's overlay blending onto a main WITH alpha is not deterministic: a
 * slice job reads the main's alpha rows (chroma un-premultiply) while the neighbouring job rewrites them
 * (alpha composite), so the bytes depended on the slice count and thread scheduling. A section frame has no
 * meaningful alpha (the segment is encoded yuv420p), so dropping it costs nothing.
 */
const OPAQUE: Filter = { type: 'format', value: 'yuv420p' };

/** The whole sub-graph: `layers` lit inside the target, clipped to its shape, during the window only. */
export function lightInTarget(fx: AnyFxContext, layers: FxLayer[]): FilterGraphChain[] | null {
  const p = fx.prefix;
  const { x, y, w, h } = fx.target;
  const lit = layers.map((layer, i): FilterGraphChain => {
    const overlay: Filter = { type: 'overlay', value: `x='${layer.x}':y='${layer.y}'` };

    return { inputs: [i === 0 ? `${p}r` : `${p}o${i - 1}`, layer.label], filters: [overlay], outputs: [`${p}o${i}`] };
  });
  const litLabel = `${p}o${layers.length - 1}`;
  const masked = maskChains(fx, litLabel, `${p}l`);
  const taps = layers.flatMap((layer) => layer.taps ?? []);
  // Every output of a split shares one negotiated pixel format: without a pinned format, a tap converted to
  // `gray` (a luma mask) drags the region, and the whole section with it, to greyscale.
  const fork: Filter[] =
    taps.length > 0
      ? [
          { type: 'format', value: 'yuv420p' },
          { type: 'split', value: String(taps.length + 1) },
        ]
      : [];

  if (masked === false) return null;

  const window = `enable='between(t,${fmt(fx.at)},${fmt(fx.end)})'`;

  return [
    { filters: [OPAQUE, { type: 'split', value: '2' }], outputs: [`${p}m`, `${p}r0`] },
    {
      inputs: [`${p}r0`],
      filters: [{ type: 'trim', value: `end=${fmt(fx.end)}` }, { type: 'crop', value: `${w}:${h}:${x}:${y}` }, ...fork],
      outputs: [`${p}r`, ...taps],
    },
    ...layers.flatMap((layer) => layer.chains),
    ...lit,
    ...(masked ?? []),
    {
      inputs: [`${p}m`, masked ? `${p}l` : litLabel],
      filters: [{ type: 'overlay', value: `${x}:${y}:eof_action=pass:${window}` }],
    },
  ];
}
