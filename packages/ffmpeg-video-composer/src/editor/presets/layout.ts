// Section layouts (schemas/layout.schemas.ts) → one engine sub-graph spliced first into the section's
// background chain, so grade/look/text sugar still apply on top of the composed frame.
//
// split: each pane source is cover-fitted (scale+crop) to its pane and overlaid at its offset onto the
// section's own frame (which shows through the gaps); dividers are static drawboxes.
// before-after: `before` full frame, then `after` is revealed by a moving edge WITHOUT a mask — the
// after leg is padded to twice the frame, cropped with a per-frame x (or y) and overlaid at a per-frame
// offset, so the picture stays put while the visible window grows:
//   right: pad after at x=W in a 2W canvas, crop x=E, overlay x=E-W → frame columns < E show `after`.
// E is the eased edge position rounded to an even pixel, so the crop (which floors to the chroma grid)
// and the overlay agree and the picture never jitters. Pure crop/pad/overlay: every backend, no seed.

import type { Filter, FilterGraphChain } from '@/core/types';
import type { BeforeAfterLayout, SectionLayout, SplitLayout } from '../../schemas/layout.schemas';
import { classifyLayoutSource, type LayoutSectionRef, type LayoutSource } from '@/core/layout/sources';
import { trackExpr } from '@/core/motion/tracks';
import { fmt } from '@/core/motion/hermite';
import type { ExtraInputSource, SugarContext } from './sugar-context';

export interface LayoutEnv {
  width: number;
  height: number;
  fps: number;
  duration: number;
  /** This section's name (a pane naming it shows the section's own frame). */
  self: string;
  sections: readonly LayoutSectionRef[];
  input: (key: string, source: ExtraInputSource) => string | null;
  color: (color: string) => string;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const P = 'lay_';
const DIVIDER = { color: '#FFFFFF', width: 4 };

function even(value: number): number {
  return Math.max(2, 2 * Math.round(value / 2));
}

function cover(w: number, h: number): Filter[] {
  return [
    { type: 'scale', value: `${w}:${h}:force_original_aspect_ratio=increase` },
    { type: 'crop', value: `${w}:${h}` },
    { type: 'setsar', value: '1' },
  ];
}

function timing(env: LayoutEnv): string {
  return `r=${env.fps}${env.duration > 0 ? `:d=${fmt(env.duration)}` : ''}`;
}

// The input label (or null) for a media/clip pane; colour and self panes need none.
function inputLabel(source: LayoutSource, key: string, env: LayoutEnv): string | null {
  if (source.kind === 'media') return env.input(key, { url: source.url, still: source.still });

  return source.kind === 'clip' ? env.input(key, { clip: source.section }) : null;
}

/** One pane: its source fitted to `w`×`h` under the pad label `out`; `self` is the split-off base. */
function paneChain(ref: string, index: number, size: Rect, env: LayoutEnv, self: string): FilterGraphChain {
  const out = `${P}p${index}`;
  const source = classifyLayoutSource(ref, env.sections, env.self) ?? { kind: 'color', color: '#000000' };
  const label = source.kind === 'self' ? self : inputLabel(source, `layout_${index}`, env);

  if (label) return { inputs: [label], filters: cover(size.w, size.h), outputs: [out] };

  const color = source.kind === 'color' ? env.color(source.color) : 'black';

  return { filters: [{ type: 'color', value: `c=${color}:s=${size.w}x${size.h}:${timing(env)}` }], outputs: [out] };
}

// The head chain: the section stream, split when panes show it too (outputs: canvas, then self legs).
function headChain(refs: readonly string[], env: LayoutEnv): { chain: FilterGraphChain; selves: string[] } {
  const selves = refs.flatMap((ref, index) => (ref === env.self ? [`${P}self${index}`] : []));
  const filters: Filter[] =
    selves.length > 0 ? [{ type: 'split', value: String(selves.length + 1) }] : [{ type: 'null' }];

  return { chain: { filters, outputs: [`${P}c`, ...selves] }, selves };
}

/** Pane rectangles: the first pane takes `ratio` of two, more panes split evenly; gaps between. */
export function splitRects(layout: SplitLayout, width: number, height: number): Rect[] {
  const vertical = layout.direction === 'vertical';
  const count = layout.sources.length;
  const gap = layout.gap ?? 0;
  const span = (vertical ? height : width) - gap * (count - 1);
  const first = count === 2 ? even(span * (layout.ratio ?? 0.5)) : even(span / count);
  const sizes = Array.from({ length: count }, (_, i) => (i === 0 ? first : even((span - first) / (count - 1))));
  let offset = 0;

  return sizes.map((size) => {
    const rect = vertical ? { x: 0, y: offset, w: width, h: size } : { x: offset, y: 0, w: size, h: height };
    offset += size + gap;

    return rect;
  });
}

function dividerBoxes(layout: SplitLayout, rects: Rect[], env: LayoutEnv): Filter[] {
  if (!layout.divider) return [];

  const thickness = layout.divider.width ?? DIVIDER.width;
  const color = layout.divider.color ?? DIVIDER.color;
  const vertical = layout.direction === 'vertical';

  return rects.slice(1).map((rect) => {
    const at = (vertical ? rect.y : rect.x) - (layout.gap ?? 0) / 2 - thickness / 2;
    const box = vertical
      ? { x: 0, y: fmt(at), w: env.width, h: fmt(thickness) }
      : { x: fmt(at), y: 0, w: fmt(thickness), h: env.height };

    const divider: Filter = { type: 'drawbox', values: { ...box, color, t: 'fill' } };

    return divider;
  });
}

function splitGraph(layout: SplitLayout, env: LayoutEnv): FilterGraphChain[] {
  const rects = splitRects(layout, env.width, env.height);
  const { chain, selves } = headChain(layout.sources, env);
  let self = 0;
  const panes = layout.sources.map((ref, index) =>
    paneChain(ref, index, rects[index], env, ref === env.self ? selves[self++] : '')
  );
  const overlays = rects.map((rect, index): FilterGraphChain => {
    const last = index === rects.length - 1;
    const overlay: Filter = { type: 'overlay', value: `${rect.x}:${rect.y}` };

    return {
      inputs: [index === 0 ? `${P}c` : `${P}o${index - 1}`, `${P}p${index}`],
      filters: last ? [overlay, ...dividerBoxes(layout, rects, env)] : [overlay],
      outputs: last ? [] : [`${P}o${index}`],
    };
  });

  return [chain, ...panes, ...overlays];
}

/** The eased wipe edge, in px along its axis, rounded to an even pixel. */
export function wipeEdge(wipe: BeforeAfterLayout['wipe'], span: number): string {
  const keys = [
    { t: wipe.at, v: 0 },
    { t: wipe.at + (wipe.duration ?? 1), v: 1, ease: wipe.ease ?? 'ease-in-out-cubic' },
  ];
  const progress = trackExpr(keys, 0);
  const reversed = wipe.direction === 'left' || wipe.direction === 'up';

  return `2*floor(${span}*(${reversed ? `1-(${progress})` : progress})/2)`;
}

// pad / crop / overlay settings per edge direction (see the header).
function wipeGeometry(wipe: BeforeAfterLayout['wipe'], env: LayoutEnv) {
  const { width: w, height: h } = env;
  const horizontal = wipe.direction !== 'down' && wipe.direction !== 'up';
  const edge = wipeEdge(wipe, horizontal ? w : h);
  const leading = wipe.direction === undefined || wipe.direction === 'right' || wipe.direction === 'down';
  const shift = leading ? `${edge}-${horizontal ? w : h}` : edge;
  const pad = horizontal ? `w=${2 * w}:h=${h}:x=${leading ? w : 0}:y=0` : `w=${w}:h=${2 * h}:x=0:y=${leading ? h : 0}`;
  const crop = horizontal ? `w=${w}:h=${h}:x='${edge}':y=0` : `w=${w}:h=${h}:x=0:y='${edge}'`;
  const overlay = horizontal ? `x='${shift}':y=0` : `x=0:y='${shift}'`;

  return { pad, crop, overlay, edge, horizontal };
}

function wipeDivider(layout: BeforeAfterLayout, env: LayoutEnv, edge: string, horizontal: boolean) {
  const thickness = even(layout.divider?.width ?? DIVIDER.width);
  const color = env.color(layout.divider?.color ?? DIVIDER.color);
  const size = horizontal ? `${thickness}x${env.height}` : `${env.width}x${thickness}`;
  const at = `${edge}-${thickness / 2}`;
  const end = layout.wipe.at + (layout.wipe.duration ?? 1);
  const enable = `enable='between(t,${fmt(layout.wipe.at)},${fmt(end)})'`;
  const place = horizontal ? `x='${at}':y=0` : `x=0:y='${at}'`;

  return [
    { filters: [{ type: 'color', value: `c=${color}:s=${size}:${timing(env)}` }], outputs: [`${P}d`] },
    { inputs: [`${P}w`, `${P}d`], filters: [{ type: 'overlay', value: `${place}:${enable}` }] },
  ];
}

function beforeAfterGraph(layout: BeforeAfterLayout, env: LayoutEnv): FilterGraphChain[] {
  const full = { x: 0, y: 0, w: env.width, h: env.height };
  const { chain, selves } = headChain([layout.before, layout.after], env);
  const [beforeSelf, afterSelf] = [
    layout.before === env.self ? selves.at(0) : '',
    layout.after === env.self ? selves.at(-1) : '',
  ];
  const before = paneChain(layout.before, 0, full, env, beforeSelf ?? '');
  const after = paneChain(layout.after, 1, full, env, afterSelf ?? '');
  const geometry = wipeGeometry(layout.wipe, env);
  const wiped = layout.divider ? [`${P}w`] : [];

  return [
    chain,
    before,
    { ...after, filters: [...after.filters, { type: 'pad', value: geometry.pad }] },
    { inputs: [`${P}c`, `${P}p0`], filters: [{ type: 'overlay', value: '0:0' }], outputs: [`${P}b`] },
    { inputs: [`${P}p1`], filters: [{ type: 'crop', value: geometry.crop }], outputs: [`${P}a`] },
    { inputs: [`${P}b`, `${P}a`], filters: [{ type: 'overlay', value: geometry.overlay }], outputs: wiped },
    ...(layout.divider ? wipeDivider(layout, env, geometry.edge, geometry.horizontal) : []),
  ];
}

/** The section layout as one sub-graph filter, or none. */
export function layoutToFilters(layout: SectionLayout | undefined, env: LayoutEnv): Filter[] {
  if (!layout) return [];

  const graph = layout.type === 'split' ? splitGraph(layout, env) : beforeAfterGraph(layout, env);

  return [{ type: 'graph', graph }];
}

/** The sugar compiler: needs the segment's input registration (absent → the layout is skipped). */
export function sectionLayoutFilters(section: { name: string; layout?: SectionLayout }, ctx: SugarContext): Filter[] {
  const masks = ctx.masks;

  if (!section.layout || !masks) return [];

  const [width, height] = ctx.scale.split(':').map(Number);

  return layoutToFilters(section.layout, {
    width,
    height,
    fps: ctx.fps,
    duration: ctx.duration,
    self: section.name,
    sections: ctx.sections ?? [],
    input: masks.input,
    color: masks.color,
  });
}
