// What an animated card draws: its tagged elements' states sampled at the output fps over the animated span
// only (first key to last, staggers included). Ticks where nothing moves are merged into one held frame, the
// first state shows from the layer's start (the lead) and the last is held by the overlay, so a 0.6 s
// entrance in a 6 s section draws ~18 frames. States are rounded, so the plan, and the frames drawn from it,
// are the same on every host. Bounded: a span over HTML_MOTION_MAX_SPAN is refused before it is walked.

import type { TrackKey } from '../motion/tracks';
import { trackSpan, trackValueAt } from '../motion/track-value';
import { applyMotionStates, motionTargets, REST_STATE, stripMotion, type ElementState } from './element-motion';
import type { LayerElement } from './html-element';
import {
  ELEMENT_MOTION_TRACKS,
  HTML_LAYER_DENSITY,
  HTML_MOTION_MAX_FRAMES,
  HTML_MOTION_MAX_PIXELS,
  HTML_MOTION_MAX_SPAN,
} from './limits';

type ElementTrack = (typeof ELEMENT_MOTION_TRACKS)[number];

export type ElementMotionSpec = Partial<Record<ElementTrack, TrackKey[]>> & { stagger?: number };

export type ElementMotionMap = Readonly<Record<string, ElementMotionSpec>>;

export interface MotionFrame {
  /** One state per tagged element, in document order. */
  states: ElementState[];
  /** How long the frame shows, in output frames (1/fps). The overlay holds the last one. */
  ticks: number;
}

export interface MotionFramePlan {
  fps: number;
  frames: MotionFrame[];
  /** The first and last animated instants, layer seconds. */
  start: number;
  end: number;
}

export type MotionPlanResult =
  | { kind: 'none' }
  | { kind: 'too-long'; span: number }
  | { kind: 'too-many-ticks'; ticks: number }
  | { kind: 'plan'; plan: MotionFramePlan };

interface Bound {
  spec: ElementMotionSpec;
  /** Seconds this element starts after its name's first element (stagger × its index among them). */
  offset: number;
}

// Float noise in `seconds × fps` must not move a tick across a key time.
const EPSILON = 1e-9;

// The most ticks one plan walks (the span limit at a generous 240 fps), so a huge fps is refused before it loops.
const MAX_TICKS = HTML_MOTION_MAX_SPAN * 240;

/** Why a plan was refused for its length: the span in seconds, or the ticks a high frame rate makes of it. */
export function overSpanReason(result: Extract<MotionPlanResult, { kind: 'too-long' | 'too-many-ticks' }>): string {
  if (result.kind === 'too-many-ticks') {
    return `a frame walk over ${result.ticks} ticks (frame rate × span; limit ${MAX_TICKS})`;
  }

  return `an animated span of ${result.span} s (limit ${HTML_MOTION_MAX_SPAN} s)`;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;

  return Math.round(value * factor) / factor || 0;
}

function boundTargets(names: readonly string[], motion: ElementMotionMap): Array<Bound | null> {
  const seen = new Map<string, number>();

  return names.map((name) => {
    const spec = Object.hasOwn(motion, name) ? motion[name] : undefined;
    const index = seen.get(name) ?? 0;

    seen.set(name, index + 1);

    return spec ? { spec, offset: index * (spec.stagger ?? 0) } : null;
  });
}

function trackAt(spec: ElementMotionSpec, track: ElementTrack, time: number, rest: number, places: number): number {
  const keys = spec[track];

  if (!keys || keys.length === 0) return rest;

  const value = trackValueAt(keys, time);

  return Number.isFinite(value) ? round(value, places) : rest;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function stateAt(spec: ElementMotionSpec, time: number): ElementState {
  return {
    x: trackAt(spec, 'x', time, 0, 2),
    y: trackAt(spec, 'y', time, 0, 2),
    scale: clamp(trackAt(spec, 'scale', time, 1, 4), 0, 10),
    rotate: trackAt(spec, 'rotate', time, 0, 2),
    opacity: clamp(trackAt(spec, 'opacity', time, 1, 4), 0, 1),
  };
}

function animatedSpan(bounds: ReadonlyArray<Bound | null>): { start: number; end: number } | null {
  let start = Infinity;
  let end = -Infinity;

  for (const bound of bounds) {
    for (const track of ELEMENT_MOTION_TRACKS) {
      const keys = bound?.spec[track];

      if (!bound || !keys || keys.length === 0) continue;

      const span = trackSpan(keys);

      if (!Number.isFinite(span.start) || !Number.isFinite(span.end)) continue;

      start = Math.min(start, span.start + bound.offset);
      end = Math.max(end, span.end + bound.offset);
    }
  }

  return Number.isFinite(start) ? { start, end } : null;
}

function sameState(a: ElementState, b: ElementState): boolean {
  return a.x === b.x && a.y === b.y && a.scale === b.scale && a.rotate === b.rotate && a.opacity === b.opacity;
}

function sameStates(a: readonly ElementState[], b: readonly ElementState[]): boolean {
  return a.every((state, index) => sameState(state, b[index]));
}

/** The frames an animated card draws, for its tagged elements' names in document order. */
export function planMotionFrames(names: readonly string[], motion: ElementMotionMap, fps: number): MotionPlanResult {
  if (!Number.isFinite(fps) || fps <= 0) return { kind: 'none' };

  const bounds = boundTargets(names, motion);
  const span = animatedSpan(bounds);

  if (!span) return { kind: 'none' };

  if (span.end - span.start > HTML_MOTION_MAX_SPAN) return { kind: 'too-long', span: round(span.end - span.start, 2) };

  const first = Math.max(0, Math.floor(span.start * fps + EPSILON));
  const last = Math.ceil(span.end * fps - EPSILON);

  if (last - first + 1 > MAX_TICKS) return { kind: 'too-many-ticks', ticks: last - first + 1 };

  const frames: MotionFrame[] = [];

  for (let tick = first; tick <= last; tick++) {
    const states = bounds.map((bound) => (bound ? stateAt(bound.spec, tick / fps - bound.offset) : REST_STATE));
    const previous = frames.at(-1);

    if (previous && sameStates(previous.states, states)) {
      previous.ticks++;

      continue;
    }

    frames.push({ states, ticks: 1 });
  }

  // The lead: before the first key every track holds its first value, which is the first frame's state.
  frames[0].ticks += first;

  return { kind: 'plan', plan: { fps, frames, start: round(span.start, 4), end: round(span.end, 4) } };
}

/** Every tagged element where its tracks end (rest when it has none). */
export function finalStates(names: readonly string[], motion: ElementMotionMap): ElementState[] {
  return boundTargets(names, motion).map((bound) => (bound ? stateAt(bound.spec, Infinity) : REST_STATE));
}

/** The still a card draws: its final state when it has a motion map, as authored otherwise. */
export function finalElement(element: LayerElement, motion: ElementMotionMap | undefined): LayerElement {
  if (!motion) return stripMotion(element);

  return applyMotionStates(element, finalStates(motionTargets(element), motion));
}

/** What a plan costs to draw at a box of `width × height` output pixels, and the first limit it breaks. */
export function motionBudget(
  plan: MotionFramePlan,
  width: number,
  height: number
): { frames: number; pixels: number; problem: string | null } {
  const frames = plan.frames.length;
  const pixels = frames * width * HTML_LAYER_DENSITY * height * HTML_LAYER_DENSITY;

  if (frames > HTML_MOTION_MAX_FRAMES) {
    return { frames, pixels, problem: `${frames} distinct frames (limit ${HTML_MOTION_MAX_FRAMES})` };
  }

  if (pixels > HTML_MOTION_MAX_PIXELS) {
    const megapixels = Math.round(pixels / 1e6);

    return { frames, pixels, problem: `${megapixels} megapixels of frames (limit ${HTML_MOTION_MAX_PIXELS / 1e6})` };
  }

  return { frames, pixels, problem: null };
}
