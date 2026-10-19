// Kinetic block → drawtext / drawbox filters (docs/plans/motion-system.md §4.1).

import type { Filter } from '@/core/types';
import type { KineticBlock } from '../../schemas/kinetic.schemas';
import type { Layout, LayoutPiece } from '@/core/kinetic/layout';
import {
  blockTop,
  resolveExit,
  resolveKinetic,
  staggerRanks,
  type KineticFrame,
  type ResolvedKinetic,
} from '@/core/kinetic/resolve';
import { layoutWithin, type FittedLayout } from '@/core/kinetic/fit';
import { unitTracks } from '@/core/kinetic/units';
import { caretBoxes, markerSweep, scrambleDecoys } from '@/core/kinetic/extras';
import { COUNTER_LOCALE_PROBE, counterBlockFilters } from './text-counter';
import { COPY_COUNTER_SECONDS, counterFromCopy } from '@/core/kinetic/counter-copy';
import { trailEchoes } from './kinetic-trail';
import { pieceFilter, type PieceDraw, type PieceStyle } from './kinetic-piece';
import { fillGraph, type FillBox, type FillEnv } from './kinetic-fill';
import type { SugarContext } from './sugar-context';
import { withMotionBlur, type KineticBlurEnv } from './kinetic-motion-blur';
import { clipParts, type ClipPart } from './clip-box';

export { MAX_KINETIC_UNITS } from '@/core/kinetic/fit';
const ACCENT_COLOR = '#FFF685';
const MARKER_COLOR = '#7C83FD@0.85';
export { BASELINE } from './kinetic-piece';

export interface KineticContext extends KineticFrame {
  /** The block's text, already resolved for locale, variables and case. */
  text: string;
  /** Where a `fill` draws (mask sub-graph); absent = the build can't, so the block stays solid. */
  fill?: FillEnv;
  /** The block's index in the section (pad-name prefix of a `clip`). */
  index?: number;
  /** Motion blur services (compile path only); absent = drawn sharp. */
  blur?: KineticBlurEnv;
}

function accentWords(block: KineticBlock, layout: Layout): Set<number> {
  const lastWord = Math.max(0, ...layout.pieces.map((piece) => piece.word));
  const words = block.accent?.words ?? (block.preset === 'highlight' ? 'last' : []);

  if (words === 'last') return new Set([lastWord]);

  if (words === 'first') return new Set([0]);

  return new Set(words);
}

interface Choreography {
  settings: ResolvedKinetic;
  layout: Layout;
  pieces: LayoutPiece[];
  ranks: number[];
  starts: number[];
  exit: ReturnType<typeof resolveExit>;
  fps: number;
  anchored: boolean;
}

// The clip slot a unit moves in, px tall: a line's box (clip "line", or "block" on one line); else none.
function slotOf(block: KineticBlock, plan: Choreography): number | undefined {
  const lines = plan.layout.lines.length;

  return block.clip === 'line' || (block.clip === 'block' && lines === 1) ? plan.settings.lineHeight : undefined;
}

function pieceDraws(block: KineticBlock, plan: Choreography): PieceDraw[] {
  const { settings, layout, exit } = plan;
  const accents = accentWords(block, layout);
  const accentColor = block.accent?.color ?? (block.preset === 'highlight' ? settings.color : ACCENT_COLOR);

  const slot = slotOf(block, plan);

  return plan.pieces.map((piece, index) => {
    const start = plan.starts[index];
    const arrive = start + settings.duration;
    const leave = exit ? Math.max(exit.at + plan.ranks[index] * exit.stagger, arrive + 1 / plan.fps) : null;
    const line = layout.lines[piece.line];
    const tracks = unitTracks(settings, piece, line.x + line.width / 2, { start, arrive, leave, slot }, exit);

    return {
      piece,
      tracks,
      start,
      arrive,
      leave: leave === null || !exit ? null : { at: leave, duration: exit.duration },
      index,
      color: accents.has(piece.word) ? accentColor : settings.color,
    };
  });
}

// highlight: a marker per accent word, held until the word has mostly faded out.
function markers(block: KineticBlock, plan: Choreography, draws: PieceDraw[]): Filter[] {
  if (plan.settings.preset !== 'highlight' || plan.settings.unit !== 'word') return [];

  const accents = accentWords(block, plan.layout);
  const { exit } = plan;

  return draws
    .filter((draw) => accents.has(draw.piece.word))
    .flatMap((draw) => {
      const leave = exit ? Math.max(exit.at + plan.ranks[draw.index] * exit.stagger, draw.arrive) : null;
      const end = leave === null || !exit ? null : leave + exit.duration * 0.6;
      const color = block.accent?.marker ?? MARKER_COLOR;

      return markerSweep(plan.settings, { piece: draw.piece, start: draw.arrive + 0.05, end, color, fps: plan.fps });
    });
}

function extras(block: KineticBlock, plan: Choreography, seed: number): Filter[] {
  const { settings, pieces, starts } = plan;

  if (settings.preset === 'typewriter' && block.caret !== false) {
    return caretBoxes(settings, pieces, starts, plan.exit?.at ?? null);
  }

  return settings.preset === 'scramble' ? scrambleDecoys(settings, pieces, starts, block.charset, seed) : [];
}

function choreograph(block: KineticBlock, ctx: KineticContext, base: ResolvedKinetic, laid: FittedLayout) {
  const settings = { ...base, unit: laid.unit };
  const top = blockTop(block.y, laid.layout.height, ctx);
  const pieces = laid.layout.pieces.map((piece) => ({ ...piece, y: piece.y + top }));
  const ranks = staggerRanks(pieces, block.order, ctx.seed);
  const starts = ranks.map((rank) => settings.delay + rank * settings.stagger);
  const exit = resolveExit(block, settings, ctx, Math.max(0, ...ranks));

  return { settings, layout: laid.layout, pieces, ranks, starts, exit, fps: ctx.fps, anchored: laid.anchored };
}

// Every unit in `style` (an empty colour = each unit's own), each preceded by its trail echoes: the
// same drawtext on a delayed clock (kinetic-trail.ts), so masks and fills keep the trail too.
function unitFilters(block: KineticBlock, plan: Choreography, draws: PieceDraw[], style: PieceStyle): Filter[] {
  return draws.flatMap((draw) => {
    const painted = { ...style, color: style.color || draw.color };
    const echoes = trailEchoes(
      block,
      draws.length,
      (time) => pieceFilter(block, plan.settings, draw, { ...painted, t: time }),
      draw
    );

    return [...echoes, pieceFilter(block, plan.settings, draw, painted)];
  });
}

function blockBox(plan: Choreography): FillBox {
  const x = Math.min(...plan.pieces.map((piece) => piece.x));
  const y = Math.min(...plan.pieces.map((piece) => piece.y));
  const right = Math.max(...plan.pieces.map((piece) => piece.x + piece.width));

  return { x, y, w: Math.max(1, right - x), h: Math.max(1, plan.layout.height) };
}

// The block drawn through a fill (kinetic-fill.ts): the same draws as white mask units, plus an
// invisible-faced copy under the fill when the block casts a shadow or outline.
function filledBlock(block: KineticBlock, plan: Choreography, draws: PieceDraw[], env: FillEnv, seed: number): Filter {
  const { settings, anchored } = plan;
  const mask = unitFilters(block, plan, draws, { color: 'white', effect: undefined, anchored });
  const clear = `${settings.color.split('@')[0]}@0`;
  const casts = block.effect ? unitFilters(block, plan, draws, { color: clear, effect: block.effect, anchored }) : [];
  const base = [...markers(block, plan, draws), ...casts, ...extras(block, plan, seed)];
  const landed = Math.max(0, ...draws.map((draw) => draw.arrive));

  return fillGraph(block.fill ?? {}, { base, mask, box: blockBox(plan), landed, solid: settings.color }, env);
}

/** The filters for one kinetic block. Empty when there is nothing to draw. */
export function kineticToFilters(block: KineticBlock, ctx: KineticContext): Filter[] {
  const base = resolveKinetic(block, ctx, ctx.text);

  if (block.preset === 'counter') return counterBlockFilters(block, base, ctx);

  const laid = ctx.text.trim() ? layoutWithin(base, ctx.text) : null;

  if (!laid) return [];

  const plan: Choreography = choreograph(block, ctx, base, laid);
  const draws = pieceDraws(block, plan);
  const filled = block.fill && ctx.fill ? [filledBlock(block, plan, draws, ctx.fill, ctx.seed)] : null;

  if (block.clip) return clippedBlock(block, plan, draws, filled, ctx);

  if (filled) return filled;

  const frame = { fps: ctx.fps, duration: ctx.duration, energy: ctx.energy, wave: plan.settings.preset === 'wave' };

  return withMotionBlur(
    block,
    [...drawnUnits(block, plan, draws), ...extras(block, plan, ctx.seed)],
    draws,
    frame,
    ctx.blur
  );
}

function drawnUnits(block: KineticBlock, plan: Choreography, draws: PieceDraw[]): Filter[] {
  const style = { effect: block.effect, anchored: plan.anchored, color: '' };

  return [...markers(block, plan, draws), ...unitFilters(block, plan, draws, style)];
}

/** Horizontal room around a clipped line (overhangs, shadows), and above a clipped block, in em. */
const CLIP_SIDE = 0.3;
const CLIP_TOP = 0.1;

// The block cut to its clip (clip-box.ts): a box, its own resting box, or one box per line (each line's
// units drawn on their own copy, so a line rising out of its slot never shows in its neighbour's). The
// typewriter caret and scramble decoys stay unclipped; a filled block clips as one block.
function clippedBlock(
  block: KineticBlock,
  plan: Choreography,
  draws: PieceDraw[],
  filled: Filter[] | null,
  ctx: KineticContext
): Filter[] {
  const clip = block.clip as NonNullable<KineticBlock['clip']>;
  const { size, lineHeight } = plan.settings;
  const frame = { width: ctx.width, height: ctx.height };
  const prefix = `kc${ctx.index ?? 0}_`;
  const loose = extras(block, plan, ctx.seed);
  const all = filled ?? drawnUnits(block, plan, draws);

  if (typeof clip === 'object') return [...loose, ...clipParts([{ box: clip, filters: all }], frame, prefix)];

  if (clip === 'block' || filled) {
    const box = blockBox(plan);
    const padded = {
      x: box.x - CLIP_SIDE * size,
      y: box.y - CLIP_TOP * size,
      w: box.w + 2 * CLIP_SIDE * size,
      h: box.h + CLIP_TOP * size,
    };

    return [...loose, ...clipParts([{ box: padded, filters: all }], frame, prefix)];
  }

  const top = Math.min(...plan.pieces.map((piece) => piece.y));
  const parts: ClipPart[] = plan.layout.lines.map((line, index) => ({
    box: { x: line.x - CLIP_SIDE * size, y: top + line.y, w: line.width + 2 * CLIP_SIDE * size, h: lineHeight },
    filters: drawnUnits(
      block,
      plan,
      draws.filter((draw) => draw.piece.line === index)
    ),
  }));

  return [...loose, ...clipParts(parts, frame, prefix)];
}

// The motion blur services for block `index`, or undefined (validation path: no capability check).
function blurEnv(index: number, ctx: SugarContext): KineticBlurEnv | undefined {
  const masks = ctx.masks;

  if (!masks?.has) return undefined;

  return { has: masks.has, warn: masks.warn, prefix: `kmb${index}_` };
}

export const MASK_UNAVAILABLE_WARNING =
  '[mask_unavailable] kinetic fill needs the alphamerge filter, absent from this FFmpeg build: the block is ' +
  'drawn in its solid colour';

// The fill environment for block `index`, or undefined (solid text) when the build can't draw masks.
function fillEnv(block: KineticBlock, index: number, ctx: SugarContext): FillEnv | undefined {
  const masks = ctx.masks;

  if (!block.fill || !masks) return undefined;

  if (!masks.available) {
    masks.warn(MASK_UNAVAILABLE_WARNING);

    return undefined;
  }

  const [width, height] = ctx.scale.split(':').map(Number);
  const key = `kinetic${index}_texture`;

  return {
    width,
    height,
    fps: ctx.fps,
    duration: ctx.duration,
    prefix: `kin${index}_`,
    texture: (url) => masks.input(key, { url, still: true }),
    color: masks.color,
  };
}

/** Every kinetic block of a section, through the sugar registry. Needs the motion context. */
export function kineticBlocksToFilters(blocks: KineticBlock[] | undefined, ctx: SugarContext): Filter[] {
  const motion = ctx.motion;

  if (!blocks || !motion) return [];

  const [width, height] = ctx.scale.split(':').map(Number);

  return blocks.flatMap((authored, index) => {
    const { block, text } = withCopy(authored, motion.resolveText);

    return kineticToFilters(block, {
      width,
      height,
      fps: ctx.fps,
      duration: ctx.duration,
      energy: motion.energy,
      seed: motion.seedFor(`kinetic[${index}]`),
      text,
      fill: fillEnv(block, index, ctx),
      index,
      blur: blurEnv(index, ctx),
    });
  });
}

// The block as lowered and its final copy. A counter ignores its copy (resolving the locale probe hands it
// the active locale instead), unless it omits `to`: then it reads its number from the copy, and copy
// without a number is drawn as a plain fade.
function withCopy(
  block: KineticBlock,
  resolve: (text: Record<string, string | undefined>) => string
): { block: KineticBlock; text: string } {
  if (block.preset !== 'counter') return { block, text: resolve(block.text) };

  const locale = resolve(COUNTER_LOCALE_PROBE);

  if (block.counter?.to !== undefined) return { block, text: locale };

  const copy = resolve(block.text);
  const counter = block.counter && counterFromCopy(block.counter, copy);
  const duration = block.duration ?? COPY_COUNTER_SECONDS;

  if (!counter) return { block: { ...block, preset: 'fade', counter: undefined, duration }, text: copy };

  return { block: { ...block, counter, duration }, text: locale };
}

/**
 * Kinetic block `index` as white mask units (the same draws the block makes, so the mask keeps every
 * unit's timing) and its resting box: what an effect targeting "text:<index>" is clipped to. Null when the
 * block is absent, empty or a counter (its glyphs change every frame).
 */
export function kineticBlockMask(
  blocks: KineticBlock[] | undefined,
  index: number,
  ctx: SugarContext
): { box: FillBox; mask: Filter[] } | null {
  const block = blocks?.[index];
  const motion = ctx.motion;

  if (!block || !motion || block.preset === 'counter') return null;

  const [width, height] = ctx.scale.split(':').map(Number);
  const seed = motion.seedFor(`kinetic[${index}]`);
  const text = motion.resolveText(block.text);
  const frame = { width, height, fps: ctx.fps, duration: ctx.duration, energy: motion.energy, seed, text };
  const base = resolveKinetic(block, frame, text);
  const laid = text.trim() ? layoutWithin(base, text) : null;

  if (!laid) return null;

  const plan = choreograph(block, frame, base, laid);
  const style = { color: 'white', effect: undefined, anchored: plan.anchored };

  return { box: blockBox(plan), mask: unitFilters(block, plan, pieceDraws(block, plan), style) };
}
