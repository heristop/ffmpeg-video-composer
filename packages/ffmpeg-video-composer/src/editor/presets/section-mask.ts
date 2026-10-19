// A mask on a video / project_video section (options.mask): the clip shows inside the mask, `background` (a
// colour token, default black) outside. A shape is lowered here as background sugar, after the grade and the
// letterbox, so every layer and text draws on top of the masked clip, unmasked; its image is an extra input
// (`smask`). A track matte reads a layer of the section, so MapManager composites it (sectionMatteSteps) when
// the overlay graph is built. Without alphamerge a shape is cut to its resting box over the backdrop, and
// anything else draws the clip unmasked.

import type { Filter, Section } from '@/core/types';
import type { SectionMask } from '../../schemas/mask.schemas';
import { evenBox, frameSize, type MapStep } from './clip-box';
import type { MatteLeg } from './layer-masks';
import { engineGraph } from '../utils/filter-graph';
import { maskFallback } from './mask-fallback';
import { backdrop, sectionMaskSteps, stepsAsGraph } from './mask-composite';
import { legToFilters, matteBlur, shapeMaskPlan, type ShapeMaskPlan } from './mask-source';
import type { MaskSugarContext, SugarContext } from './sugar-context';

export const SECTION_MASK_KEY = 'smask';
// Pad labels carry two '.', which no input name can and no layer pad (`<name>.mk_*`, one '.') does.
const P = 'sm.s.';

// The clip cut to the mask's resting box over the backdrop: split, drawbox, crop, overlay.
function boxFallback(plan: ShapeMaskPlan, color: string, scale: string): Filter[] {
  const box = evenBox(plan.box, ...frameSize(scale));

  if (!box) return [backdrop(color)];

  return [
    {
      type: 'graph',
      graph: engineGraph([
        { filters: [{ type: 'split', value: '2' }], outputs: [`${P}o`, `${P}c`] },
        { inputs: [`${P}o`], filters: [backdrop(color)], outputs: [`${P}b`] },
        {
          inputs: [`${P}c`],
          filters: [{ type: 'crop', value: `${box.w}:${box.h}:${box.x}:${box.y}` }],
          outputs: [`${P}k`],
        },
        { inputs: [`${P}b`, `${P}k`], filters: [{ type: 'overlay', value: `${box.x}:${box.y}` }] },
      ]),
    },
  ];
}

function unavailable(mask: SectionMask, ctx: SugarContext, masks: MaskSugarContext): Filter[] {
  const { need, outcome } = maskFallback(mask);

  masks.warn(`[mask_unavailable] options.mask: ${need} needs alphamerge, absent from this FFmpeg build; ${outcome}`);

  const plan = mask.shape && !mask.invert ? shapeMaskPlan(mask, SECTION_MASK_KEY, ctx.fps) : null;

  return plan ? boxFallback(plan, masks.color(mask.background ?? 'black'), ctx.scale) : [];
}

function shapeGraph(mask: SectionMask, ctx: SugarContext, masks: MaskSugarContext): Filter[] {
  const plan = shapeMaskPlan(mask, SECTION_MASK_KEY, ctx.fps);
  const label = plan ? masks.input(plan.key, { url: plan.url, still: true }) : null;

  if (!plan || !label) return [];

  const moved = plan.legFilters.length > 0 ? legToFilters(plan.legFilters) : [{ type: 'null' }];
  const source = { inputs: [label], filters: moved, outputs: [`${P}l`] };
  const steps = sectionMaskSteps({
    base: `${P}in`,
    background: masks.color(mask.background ?? 'black'),
    source: { pad: `${P}l`, overlay: `x='${plan.x}':y='${plan.y}'`, invert: mask.invert },
    prefix: P,
    out: `${P}out`,
  });

  return [stepsAsGraph(steps, [source])];
}

/** The section's shape mask as background sugar (a track matte is composited by MapManager). */
export function sectionMaskFilters(section: Section, ctx: SugarContext): Filter[] {
  const mask = section.options?.mask;
  const masks = ctx.masks;

  if (!mask || !masks) return [];

  if (!masks.available) return unavailable(mask, ctx, masks);

  return mask.shape ? shapeGraph(mask, ctx, masks) : [];
}

export interface SectionMatteRequest {
  mask: SectionMask;
  matte: MatteLeg;
  /** The pad every later layer draws on: the clip, or the running composite when layers already drew. */
  base: string;
  /** Resolved colour token shown outside the matte (refused when it would leave the option). */
  background: string;
}

/** The clip through its track matte (options.mask.layer) over a solid backdrop, out as `sm.s.mk_out`. */
export function sectionMatteSteps(r: SectionMatteRequest): MapStep[] {
  const source = { ...r.matte, invert: r.mask.invert, blur: matteBlur(r.mask.feather) };

  return sectionMaskSteps({ base: r.base, background: r.background, source, prefix: `${P}mk_`, out: `${P}mk_out` });
}
