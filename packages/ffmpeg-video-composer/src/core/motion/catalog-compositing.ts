// Catalog entries for masks, layouts and complex scripts (motionCatalog: kinetic.fill, layouts, rules).
import type { BlendMode } from '../../schemas/layer-composite.schemas';

export const COMPOSITING_RULES = [
  'Fill a hero word with kinetic[].fill (gradient { from, to, angle } or { stops }, texture image, sweep shimmer) ' +
    'instead of a flat colour; keep `color` legible — it is the fallback on builds without alphamerge.',
  'Copy in Arabic, Hebrew, Devanagari, Thai… animates per line (letters must join): pick line-friendly presets ' +
    '(rise, fade, slide, split) and a font that covers the script (noto-arabic, noto-hebrew).',
  'Compare with sections[].layout: { type: "split", sources: [...] } for side-by-side panes, or ' +
    '{ type: "before-after", before, after, wipe: { at, duration, direction, ease } } for a reveal wipe.',
  'Blend with options.blend, not opacity (multiply ink, screen glows, add sparks); give fast moves motionBlur. ' +
    'options.clip and options.mask exclude both; clipped or filled kinetic and entrance presets are not blurred.',
  'Mask a layer or video section (options.mask) instead of hiding part of it behind a background-coloured panel: ' +
    'a shape or another layer as a track matte (alpha or luma). Animate it for irises and wipes; feather, invert. ' +
    'Without alphamerge a shape mask falls back to its box; a track matte draws both layers.',
];

export const KINETIC_FILL: Record<string, string> = {
  gradient:
    '{ from, to, angle? } or { stops: [2–8 colours], angle? }: a sweep across the block (CSS angle, 90 = left→right).',
  texture: 'An image URL/path seen through the letters (cover-fitted to the frame); wins over gradient.',
  sweep: '{ duration?, width?, color?, delay?, every? }: a soft highlight band crossing the letters (shimmer).',
};

export const LAYOUTS: Record<string, string> = {
  split:
    '{ sources: [2–4 refs], direction?: horizontal|vertical, ratio?, gap?, divider?: { color, width } }: panes ' +
    'side by side or stacked. A ref is a section name (its colour / picture / video / clip), this section, a URL or #colour.',
  'before-after':
    '{ before, after, wipe: { at, duration?, direction?: right|left|down|up, ease? }, divider? }: `after` wipes in over `before`.',
};

export const BLEND_MODE_GUIDE: Record<BlendMode, string> = {
  normal: 'Default.',
  multiply: 'Darkens like ink.',
  screen: 'Lightens, glows.',
  overlay: 'Contrast.',
  add: 'Adds light.',
  darken: 'Darker.',
  lighten: 'Lighter.',
  difference: 'Inverts.',
};

export const MOTION_BLUR_GUIDE: Record<string, string> = {
  motionBlur: 'Motion blur: options.motionBlur, kinetic[].motionBlur; true or { shutter, samples }.',
  shutter: '0..360, 180.',
  samples: '2..16, 8.',
};

export const MASKS: Record<string, string> = {
  'mask.shape': 'rect { x, y, w, h, radius? } | ellipse { cx, cy, rx, ry } | path { d }: shows inside it, output px.',
  'mask.layer':
    'Track matte: another image / animation / html input read as alpha (default) or luma (mode); not drawn.',
  'mask.invert': 'Show outside the mask: a hole.',
  'mask.feather': 'Soft edge in px (0–200).',
  'mask.animate': 'Shape tracks: x, y, scale (0 → 1.2 opens an iris), scaleX, scaleY, rotate.',
  'mask.background': 'Sections only: colour outside the mask (default black); html word + luma = clip inside letters.',
};

export interface CompositingCatalog {
  /** `kinetic[].fill` shapes: gradient / texture / sweep. */
  kineticFill: Record<string, string>;
  /** `sections[].layout` types: split / before-after. */
  layouts: Record<string, string>;
  /** `inputs[].options.blend` modes. */
  blendModes: Record<BlendMode, string>;
  /** `motionBlur` on layers and kinetic blocks, and its fields. */
  motionBlur: Record<string, string>;
  /** `options.mask` fields on layers and video sections. */
  masks: Record<string, string>;
}

export const COMPOSITING: CompositingCatalog = {
  kineticFill: KINETIC_FILL,
  layouts: LAYOUTS,
  blendModes: BLEND_MODE_GUIDE,
  motionBlur: MOTION_BLUR_GUIDE,
  masks: MASKS,
};

// HTML layers composite over the frame like images; their catalog entry lives with the layout code.
export { htmlCatalog, type HtmlCatalog } from '../html/html-catalog';
