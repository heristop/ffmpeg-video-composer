// packages/ffmpeg-video-composer/src/editor/presets/shape-draw.ts
// The shape graphic → filters, on-device. The filled (and stroked) outline is rasterised once at compile time
// (shape-raster.ts, a `shape:` generated image registered as an extra input) and laid over the frame through
// the layer keyframe leg (layer-keyframes.ts): the same fps / scale / rotate / colorchannelmixer / format /
// overlay filters an image layer with options.animate lowers to, so a shape scales, turns, moves and fades
// on springs exactly like a card. stroke.draw hands the outline to the path graphic's trim-path reveal
// (path-draw.ts: lutyuv, alphamerge, overlay) and fades the fill in once it closes. Every filter is on the
// on-device allowlist.

import type { Filter } from '@/core/types';
import { layerKeyframes } from './layer-keyframes';
import { lowerPath } from './path-draw';
import { window } from './path-plan';
import { closeGraph, stageChain } from './stroke-lower';
import { planShape, warn, type ShapePlan } from './shape-plan';
import { shapeUrl } from './shape-raster';
import type { ShapeRequest } from './sugar-context';

/** A "name=options" filter string (the layer leg's form) as a Filter. */
export function toFilter(text: string): Filter {
  const eq = text.indexOf('=');

  return eq < 0 ? { type: text } : { type: text.slice(0, eq), value: text.slice(eq + 1) };
}

// The image laid over the frame, or [] when there is no image, or null when the segment refuses the input.
function fillGraph(request: ShapeRequest, plan: ShapePlan): Filter[] | null {
  if (!plan.spec) return [];

  const label = request.ctx.masks?.input(`sh${request.index}_fill`, { url: shapeUrl(plan.spec), still: true }) ?? null;

  if (!label) return null;

  const { box } = plan;
  const leg = layerKeyframes(
    {
      position: `${box.x}:${box.y}`,
      scale: `${box.w}:${box.h}`,
      animate: plan.animate,
      origin: request.graphic.origin,
    },
    request.ctx.fps
  );
  const p = `sh${request.index}_`;
  const overlay = `x='${leg.x}':y='${leg.y}':eof_action=pass:enable='${window(request.at, request.until)}'`;

  return closeGraph([
    stageChain(undefined, [], `${p}m`),
    stageChain([label], leg.legFilters.map(toFilter), `${p}s`),
    { inputs: [`${p}m`, `${p}s`], filters: [{ type: 'overlay', value: overlay }] },
  ]);
}

/** One shape graphic as filters ([] after a warning when it cannot be drawn here). */
export function lowerShape(request: ShapeRequest): Filter[] {
  const plan = planShape(request);

  if (!plan) return [];

  const fill = fillGraph(request, plan);

  if (!fill) {
    warn(request, 'shape_unavailable', 'its image needs an extra input this segment cannot take; skipped');

    return [];
  }

  const outline = plan.outline ? lowerPath({ ...request, graphic: plan.outline }) : [];

  return [...fill, ...outline];
}
