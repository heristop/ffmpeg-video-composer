// Timeline events for kinetic blocks and animated graphics, from the same resolvers the lowering uses:
// preset defaults, physics-derived durations, stagger ranks, layout and graphic specs.

import type { KineticBlock } from '../../schemas/kinetic.schemas';
import type { Graphic } from '../../schemas/graphics.schemas';
import { blockTop, resolveExit, resolveKinetic, staggerRanks, type KineticFrame } from '../kinetic/resolve';
import { codePoints, type Layout, type LayoutPiece } from '../kinetic/layout';
import { layoutWithin } from '../kinetic/fit';
import { graphicTiming } from '../../editor/presets/graphics';
import {
  authoredId,
  easeKey,
  round,
  textOf,
  type ElementFrame,
  type MotionBox,
  type MotionEvent,
  timeOf,
} from './timeline-model';

/** Graphics that are light hits, pixel effects or in-scene page turns rather than elements entering. */
const HIT_GRAPHICS = new Set(['flash', 'wipe', 'glitch', 'focus']);
/** Graphics that keep moving after their entrance until they leave (the ticker scrolls). */
const CONTINUOUS_GRAPHICS = new Set(['ticker']);

function kineticFrame(frame: ElementFrame): KineticFrame {
  return {
    width: frame.width,
    height: frame.height,
    fps: frame.fps,
    duration: frame.duration,
    seed: 0,
    energy: frame.energy,
  };
}

// How many units animate when the block can't be laid out (unbundled font): the same split, unmeasured.
function unitCount(text: string, unit: string): number {
  if (unit === 'line') return text.split('\n').length;

  const words = text.split(/\s+/).filter(Boolean);

  return unit === 'word' ? words.length : codePoints(words.join('')).length;
}

function layoutBox(layout: Layout, top: number): MotionBox {
  const left = Math.min(...layout.lines.map((line) => line.x));
  const right = Math.max(...layout.lines.map((line) => line.x + line.width));

  return { x: round(left), y: round(top), width: round(right - left), height: round(layout.height) };
}

interface KineticPlan {
  start: number;
  arrive: number;
  spread: number;
  maxRank: number;
  bbox?: MotionBox;
}

function kineticPlan(block: KineticBlock, frame: ElementFrame, text: string): KineticPlan {
  const ctx = kineticFrame(frame);
  const settings = resolveKinetic(block, ctx, text);
  const laid = block.preset === 'counter' || !text.trim() ? null : layoutWithin(settings, text);
  const count = block.preset === 'counter' ? 1 : (laid?.layout.pieces.length ?? unitCount(text, settings.unit));
  const pieces = Array.from({ length: Math.max(1, count) }, () => ({}) as LayoutPiece);
  const maxRank = Math.max(0, ...staggerRanks(pieces, block.order, 0));
  const spread = maxRank * settings.stagger;
  const bbox = laid ? layoutBox(laid.layout, blockTop(block.y, laid.layout.height, ctx)) : undefined;

  return { start: settings.delay, arrive: settings.delay + spread + settings.duration, spread, maxRank, bbox };
}

function kineticExit(block: KineticBlock, frame: ElementFrame, plan: KineticPlan, text: string): MotionEvent | null {
  const ctx = kineticFrame(frame);
  const exit = resolveExit(block, resolveKinetic(block, ctx, text), ctx, plan.maxRank);

  if (!exit) return null;

  // Each unit leaves at its exit slot, but never before it has arrived (as the lowering times it).
  const settle = plan.arrive - plan.spread;
  const start = Math.max(exit.at, settle);
  const end = Math.max(exit.at + plan.maxRank * exit.stagger, plan.arrive) + exit.duration;

  return {
    path: '',
    element: '',
    kind: 'exit',
    start: round(start),
    end: round(end),
    ease: easeKey(exit.ease),
    visibleFrom: round(plan.start),
    visibleUntil: round(end),
    entrance: false,
    text: true,
  };
}

/** The entrance (and exit, when authored) of one kinetic block. */
export function kineticEvents(block: KineticBlock, index: number, frame: ElementFrame): MotionEvent[] {
  const text = block.preset === 'counter' ? '' : textOf(block.text);
  const plan = kineticPlan(block, frame, text);
  const element = `kinetic[${index}]`;
  const path = `${frame.prefix}.${element}`;
  const id = authoredId(block);
  const exit = kineticExit(block, frame, plan, text);
  const ease = easeKey(resolveKinetic(block, kineticFrame(frame)).ease);
  const entrance: MotionEvent = {
    path,
    element,
    ...(id && { id }),
    kind: 'kinetic',
    start: round(plan.start),
    end: round(plan.arrive),
    ease,
    visibleFrom: round(plan.start),
    visibleUntil: round(exit?.end ?? frame.duration),
    ...(plan.bbox && { bbox: plan.bbox }),
    entrance: true,
    text: true,
    preset: block.preset,
    spread: round(plan.spread),
    words: block.preset === 'counter' ? 1 : unitCount(text, 'word'),
    ...(block.preset === 'wave' && { continuous: true }),
  };

  return exit ? [entrance, { ...exit, path: `${path}.exit`, element, ...(id && { id }) }] : [entrance];
}

/** The animation of one graphic: when it draws on, on which curve, and how long it stays. */
export function graphicEvent(graphic: Graphic, index: number, frame: ElementFrame): MotionEvent {
  const timing = graphicTiming(graphic, frame);
  const at = timeOf(graphic.at);
  const end = at + timing.duration;
  const element = `graphics[${index}]`;
  const id = authoredId(graphic);
  const until = timing.holds ? timeOf(graphic.until, frame.duration) : end;
  const bbox = timing.bbox
    ? { x: round(timing.bbox.x), y: round(timing.bbox.y), width: round(timing.bbox.w), height: round(timing.bbox.h) }
    : undefined;

  return {
    path: `${frame.prefix}.${element}`,
    element,
    ...(id && { id }),
    kind: 'graphic',
    start: round(at),
    end: round(end),
    ease: easeKey(timing.ease),
    visibleFrom: round(at),
    visibleUntil: round(Math.max(end, until)),
    ...(bbox && { bbox }),
    entrance: !HIT_GRAPHICS.has(graphic.type),
    text: false,
    preset: graphic.type,
    ...(CONTINUOUS_GRAPHICS.has(graphic.type) && { continuous: true }),
  };
}
