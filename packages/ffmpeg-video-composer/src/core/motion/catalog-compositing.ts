// Catalog entries for masks, layouts and complex scripts (motionCatalog: kinetic.fill, layouts, rules).

export const COMPOSITING_RULES = [
  'Fill a hero word with kinetic[].fill (gradient { from, to, angle } or { stops }, texture image, sweep shimmer) ' +
    'instead of a flat colour; keep `color` legible — it is the fallback on builds without alphamerge.',
  'Copy in Arabic, Hebrew, Devanagari, Thai… animates per line (letters must join): pick line-friendly presets ' +
    '(rise, fade, slide, split) and a font that covers the script (noto-arabic, noto-hebrew).',
  'Compare with sections[].layout: { type: "split", sources: [...] } for side-by-side panes, or ' +
    '{ type: "before-after", before, after, wipe: { at, duration, direction, ease } } for a reveal wipe.',
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

export interface CompositingCatalog {
  /** `kinetic[].fill` shapes: gradient / texture / sweep. */
  kineticFill: Record<string, string>;
  /** `sections[].layout` types: split / before-after. */
  layouts: Record<string, string>;
}

export const COMPOSITING: CompositingCatalog = { kineticFill: KINETIC_FILL, layouts: LAYOUTS };

// HTML layers composite over the frame like images; their catalog entry lives with the layout code.
export { htmlCatalog, type HtmlCatalog } from '../html/html-catalog';
