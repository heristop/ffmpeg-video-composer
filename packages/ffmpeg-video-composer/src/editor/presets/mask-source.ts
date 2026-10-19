// What a mask is read from, as an overlay leg that mask-composite.ts lays on a black frame-size canvas: a
// shape's compile-time grey image (mask-raster.ts), still or moved by its keyframe tracks through the layer
// track machinery (layer-keyframes.ts), or a track matte layer's own leg reduced to grey — its alpha copied
// into its colour channels (then dropped, so the canvas overlay does not multiply it in twice) or its luma as
// drawn (the overlay's own alpha blending makes transparent parts black).

import type { Filter } from '@/core/types';
import { assertFiniteNumber } from '@/core/arg-guard';
import {
  MAX_MASK_FEATHER,
  type LayerMask,
  type MaskAnimate,
  type MaskMode,
  type MaskShape,
} from '../../schemas/mask.schemas';
import { layerKeyframes } from './layer-keyframes';
import { placeMask } from './mask-shape';
import { maskUrl } from './mask-raster';

export interface ShapeMaskPlan {
  /** Extra-input key the mask image is registered under. */
  key: string;
  /** The `mask:` URL of its image (generated-images.ts). */
  url: string;
  /** The image's resting box in frame px (the fallback clip box). */
  box: { x: number; y: number; w: number; h: number };
  /** Leg filters moving the image; empty for a still mask. */
  legFilters: string[];
  /** Overlay x / y of the image on the canvas. */
  x: string;
  y: string;
}

/** Copies a layer's alpha into its colour channels: its matte as a grey picture (alpha left as is). */
export const ALPHA_TO_GREY = 'colorchannelmixer=rr=0:rg=0:rb=0:ra=1:gr=0:gg=0:gb=0:ga=1:br=0:bg=0:bb=0:ba=1';

type Track = NonNullable<MaskAnimate['x']>;

// x / y keys are offsets from where the shape sits: a plain number is read as a relative key.
function offsets(keys: Track): Track {
  return keys.map((key) =>
    typeof key.v === 'number' ? { ...key, v: `${key.v < 0 ? '-' : '+'}${Math.abs(key.v)}` } : key
  );
}

function offsetTracks(animate: MaskAnimate): MaskAnimate {
  return {
    ...animate,
    ...(animate.x && { x: offsets(animate.x) }),
    ...(animate.y && { y: offsets(animate.y) }),
  };
}

const SHAPE_NUMBERS = ['x', 'y', 'w', 'h', 'radius', 'cx', 'cy', 'rx', 'ry'] as const;

// A feather inside the schema's range: library callers skip validation, and a wider one makes the mask URL
// unloadable or the blur sigma unusable.
function clampFeather(feather: number | undefined): number {
  return Math.min(MAX_MASK_FEATHER, Math.max(0, assertFiniteNumber(feather ?? 0, 'mask feather')));
}

// Library callers skip validation: every shape number is coerced before it is interpolated (path strings are
// bounded and tokenised by placeMask).
function finiteShape(shape: MaskShape): MaskShape {
  const guarded: Record<string, unknown> = { ...shape };

  for (const field of SHAPE_NUMBERS) {
    if (field in guarded && guarded[field] !== undefined) {
      guarded[field] = assertFiniteNumber(guarded[field], `mask ${field}`);
    }
  }

  return guarded as MaskShape;
}

/** The image, resting box and motion of a shape mask; null without a shape or for an unfillable one. */
export function shapeMaskPlan(
  mask: Pick<LayerMask, 'shape' | 'feather' | 'animate' | 'origin'>,
  key: string,
  fps: number
): ShapeMaskPlan | null {
  const feather = clampFeather(mask.feather);
  const placed = mask.shape ? placeMask(finiteShape(mask.shape), feather) : null;

  if (!placed?.ok) return null;

  const { x, y, w, h, path } = placed.mask;
  const still = { key, url: maskUrl({ w, h, feather: placed.mask.feather, path }), box: { x, y, w, h } };

  if (!mask.animate) return { ...still, legFilters: [], x: String(x), y: String(y) };

  const options = {
    position: `${x}:${y}`,
    scale: `${w}:${h}`,
    animate: offsetTracks(mask.animate),
    origin: mask.origin,
  };
  const plan = layerKeyframes(options, fps);

  return { ...still, legFilters: plan.legFilters, x: plan.x, y: plan.y };
}

/** A matte layer's leg filters reduced to its grey matte (alpha by default). Never empty: the leg is a pad. */
export function matteLegFilters(mode: MaskMode | undefined, legFilters: readonly string[]): string[] {
  if ((mode ?? 'alpha') === 'luma') return legFilters.length > 0 ? [...legFilters] : ['null'];

  return [...legFilters, 'format=rgba', ALPHA_TO_GREY, 'format=gbrp'];
}

/** Gaussian sigma of a feathered track matte (its 10–90 % ramp ≈ 2.5 σ); none without a feather. */
export function matteBlur(feather: number | undefined): number | undefined {
  const radius = clampFeather(feather);

  return radius > 0 ? radius / 2.5 : undefined;
}

/** Leg filter strings ("name=options") as engine filters, for a sub-graph chain. */
export function legToFilters(leg: readonly string[]): Filter[] {
  return leg.map((filter) => {
    const at = filter.indexOf('=');

    return at < 0 ? { type: filter } : { type: filter.slice(0, at), value: filter.slice(at + 1) };
  });
}
