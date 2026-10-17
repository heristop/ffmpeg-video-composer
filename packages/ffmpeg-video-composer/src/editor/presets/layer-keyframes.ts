// Keyframe tracks on an image, animation or html layer input (inputs[].options.animate) lowered onto the
// overlay leg and the overlay position. Schema: schemas/layer-animate.schemas.ts.
//
// - x / y: overlay x/y expressions in t (core/motion/tracks.ts), relative keys from options.position.
// - rotate: one `rotate` on the layer's own frame, angle an expression in t, inside a transparent square
//   that holds the layer's diagonal (c=black@0: `c=none` leaves stale pixels around a moving angle).
// - scale / scaleX / scaleY: one `scale` with eval=frame AFTER the turn, sizes in pixels from the layer
//   box (even, ≥ 2 px, like the fx sprites), so the scale is in screen space.
// - opacity: colorchannelmixer steps gated per frame (layer-opacity.ts).
// The overlay then places the frame so the chosen origin of the box stays put. Every filter runs on the
// layer's own small frame, all of them on the on-device allowlist, and a property without a track adds
// nothing. A per-frame transform conforms the leg to the section frame rate first (a looped still decodes
// at 25 fps), so it steps on every output frame.

import type { OverlayFit, OverlayFlip, Reveal } from '@/core/types';
import { assertFiniteNumber } from '@/core/arg-guard';
import { fmt } from '@/core/motion/hermite';
import { trackExpr } from '@/core/motion/tracks';
import type { LayerAnimate, LayerOrigin } from '../../schemas/layer-animate.schemas';
import { buildAnimationLegFilters, overlayMotionExpr } from '../utils/input-sources';
import { even, sizeExpr } from './fx-marks';
import { opacitySteps } from './layer-opacity';
import { placeLayer, restPosition, type Box } from './layer-position';

export interface LayerKeyframeOptions {
  position?: string;
  scale?: string;
  fit?: OverlayFit;
  flip?: OverlayFlip;
  rotation?: number;
  opacity?: number;
  motion?: Reveal;
  animate?: LayerAnimate;
  origin?: LayerOrigin;
}

export interface LayerKeyframePlan {
  /** The whole overlay leg, replacing buildAnimationLegFilters' chain. */
  legFilters: string[];
  /** Overlay x / y expressions (overlay variables: w, h = the leg frame). */
  x: string;
  y: string;
}

interface Transform {
  box: Box | null;
  /** Rotation in degrees (a number, or an expression in t); null leaves the layer upright, untouched. */
  turn: string | number | null;
  /** Horizontal / vertical scale factors; null when the layer is not scaled. */
  scale: { x: string; y: string } | null;
}

// "W:H" in plain positive pixels, else unknown.
function boxOf(scale: string | undefined): Box | null {
  const match = /^\s*(\d+)\s*:\s*(\d+)\s*$/.exec(scale ?? '');

  if (!match || Number(match[1]) === 0 || Number(match[2]) === 0) return null;

  return { w: Number(match[1]), h: Number(match[2]) };
}

function product(...factors: Array<string | null>): string | null {
  const present = factors.filter((factor): factor is string => factor !== null);

  if (present.length < 2) return present[0] ?? null;

  return present.map((factor) => `(${factor})`).join('*');
}

function trackOf(animate: LayerAnimate, key: keyof LayerAnimate): string | null {
  const keys = animate[key];

  return keys ? trackExpr(keys) : null;
}

function scaleOf(animate: LayerAnimate): Transform['scale'] {
  if (!animate.scale && !animate.scaleX && !animate.scaleY) return null;

  const uniform = trackOf(animate, 'scale');

  return {
    x: product(uniform, trackOf(animate, 'scaleX')) ?? '1',
    y: product(uniform, trackOf(animate, 'scaleY')) ?? '1',
  };
}

// The rotate track from options.rotation; a static rotation joins the turn when the layer also scales, so
// its box stays known.
function turnOf(options: LayerKeyframeOptions, scaled: boolean): Transform['turn'] {
  const rotation = assertFiniteNumber(options.rotation ?? 0, 'layer rotation');

  if (options.animate?.rotate) return trackExpr(options.animate.rotate, rotation);

  return scaled && rotation !== 0 ? rotation : null;
}

function transformOf(options: LayerKeyframeOptions): Transform {
  const scale = scaleOf(options.animate ?? {});
  const turn = turnOf(options, scale !== null);
  const box = boxOf(options.scale);

  if ((scale !== null || turn !== null) && box === null) {
    throw new Error(
      'layer animate: scale/rotate tracks need the layer box; set options.scale to "W:H" pixels (an html layer has it)'
    );
  }

  return { box, turn, scale };
}

// The static leg: fit / flip / opacity as without tracks. The static box scale is skipped when a scale
// track sizes the frame from the source itself (sharper, e.g. a 2× html raster), and a static rotation
// joins the turn.
function staticLeg(options: LayerKeyframeOptions, transform: Transform): string[] {
  const free = (options.fit ?? 'stretch') === 'stretch';
  const sizedByTrack = transform.scale !== null && transform.turn === null && free;

  return buildAnimationLegFilters({
    scale: sizedByTrack ? undefined : options.scale,
    fit: options.fit,
    flip: options.flip,
    rotation: transform.turn === null ? options.rotation : 0,
    opacity: options.opacity,
  });
}

function transformFilters(transform: Transform): string[] {
  const { box, turn, scale } = transform;

  if (box === null) return [];

  const side = even(Math.hypot(box.w, box.h) + 2);
  const filters: string[] = [];

  if (turn !== null) {
    const angle = typeof turn === 'number' ? fmt(turn) : turn;
    filters.push(`rotate=a='(${angle})*PI/180':ow=${side}:oh=${side}:c=black@0`);
  }

  if (scale !== null) {
    const [w, h] = turn === null ? [box.w, box.h] : [side, side];
    filters.push(`scale=w='${sizeExpr(w, scale.x)}':h='${sizeExpr(h, scale.y)}':eval=frame`);
  }

  return filters;
}

interface LegParts {
  fade: string | undefined;
  opacity: string[];
  /** The leg needs an alpha channel: an opacity track, a turn or a fade entrance. */
  alpha: boolean;
  perFrame: boolean;
}

function assembleLeg(base: string[], transform: Transform, parts: LegParts, fps: number): string[] {
  const alpha = parts.alpha && !base.includes('format=rgba') ? ['format=rgba'] : [];

  return [
    ...(parts.perFrame ? [`fps=${fps}`] : []),
    ...base,
    ...alpha,
    ...(parts.fade ? [parts.fade] : []),
    ...parts.opacity,
    ...transformFilters(transform),
  ];
}

/** The overlay leg and position of a layer with `options.animate` tracks. */
export function layerKeyframes(options: LayerKeyframeOptions, fps: number): LayerKeyframePlan {
  const animate = options.animate ?? {};
  const transform = transformOf(options);
  const motion = overlayMotionExpr(options.motion, restPosition(options, transform));
  // A track overrides the same property of the entrance: an opacity track replaces a fade.
  const fade = animate.opacity ? undefined : motion.legFilter;
  const parts: LegParts = {
    fade,
    opacity: animate.opacity ? opacitySteps(animate.opacity, fps) : [],
    alpha: Boolean(animate.opacity) || transform.turn !== null || fade !== undefined,
    perFrame: Boolean(animate.opacity) || transform.turn !== null || transform.scale !== null,
  };
  const legFilters = assembleLeg(staticLeg(options, transform), transform, parts, fps);

  return { legFilters, ...placeLayer(options, transform, motion) };
}
