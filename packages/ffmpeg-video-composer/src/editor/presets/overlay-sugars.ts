// The overlay half of the sugar registry (registry.ts): the sugars drawn on top of the composited frame.
// Kept apart from the background sugars (layout, layers, motion, camera, grade, look, letterbox) because
// validation lowers only these to find where text lands (services/geometry/draw-layers), and the browser
// entry's synchronous validation must not pull the background presets into its eager load.
import type { Filter, Section } from '@/core/types';
import { captionToFilters } from './captions';
import { titleCardToFilters } from './text-blocks';
import { lowerThirdFilters } from './lower-third-styles';
import { kineticBlocksToFilters } from './kinetic';
import { subtitlesToFilters } from './subtitles';
import { freezeFlashFilters, graphicsToFilters } from './graphics';
import type { SugarContext } from './sugar-context';

// Where a sugar's filters sit relative to an animation/gradient overlay graph:
// - 'background' bakes into the video before overlays (colour grade, motion, layers).
// - 'overlay' draws on top of the composited frame (text: caption, titleCard, lowerThird) so it is
//   visible above an animation overlay rather than buried under it.
// - 'top' draws over everything the section draws, its authored filters included (`above: true`
//   graphics, freeze flashes): an authored mask or text never hides it.
export type SugarLayer = 'background' | 'overlay' | 'top';

// A single structured-sugar field (look/grade/motion/caption/…) and how it lowers to raw filters.
// `order` fixes its position in the section's filter chain; lower runs first. Registering a new
// sugar is one entry in registry.ts (or here, for an overlay) — SegmentBuilder reads the registry
// rather than hardcoding the set/order.
export type SugarCompiler = {
  key: string;
  order: number;
  layer: SugarLayer;
  compile: (section: Section, ctx: SugarContext) => Filter[];
};

/** The overlay sugars, in registry order (registry.ts appends them after the background ones). */
export const OVERLAY_SUGAR_COMPILERS: SugarCompiler[] = [
  {
    key: 'caption',
    order: 50,
    layer: 'overlay',
    compile: (section, ctx) => captionToFilters(section.caption, ctx),
  },
  {
    key: 'titleCard',
    order: 55,
    layer: 'overlay',
    compile: (section, ctx) =>
      titleCardToFilters(section.titleCard, { scale: ctx.scale, backgroundColor: section.options?.backgroundColor }),
  },
  {
    key: 'lowerThird',
    order: 58,
    layer: 'overlay',
    compile: (section, ctx) =>
      lowerThirdFilters(section.lowerThird, { scale: ctx.scale, fps: ctx.fps, resolveText: ctx.motion?.resolveText }),
  },
  {
    key: 'graphics',
    order: 52,
    layer: 'overlay',
    compile: (section, ctx) => graphicsToFilters(section, ctx, false),
  },
  {
    key: 'kinetic',
    order: 60,
    layer: 'overlay',
    compile: (section, ctx) => kineticBlocksToFilters(section.kinetic, ctx),
  },
  {
    key: 'subtitles',
    order: 65,
    layer: 'overlay',
    compile: (section, ctx) => subtitlesToFilters(section.subtitles, ctx),
  },
  {
    key: 'graphics-above',
    order: 70,
    layer: 'top',
    compile: (section, ctx) => graphicsToFilters(section, ctx, true),
  },
  {
    // A freeze frame's optional flash hit (options.freeze[].flash), on top of everything like a flash graphic.
    key: 'freeze-flash',
    order: 75,
    layer: 'top',
    compile: (section, ctx) => freezeFlashFilters(section, ctx),
  },
];
