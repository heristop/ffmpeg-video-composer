// The motion timeline model: what moves in each section, when, on which curve, and where it rests.
// Shared by the timeline builders, the pacing lint and the motion assertions.

import type { EasingSpec } from './easing';

export type MotionKind = 'kinetic' | 'graphic' | 'camera' | 'reveal' | 'exit' | 'animate' | 'transition';

export interface MotionBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MotionEvent {
  /** Full descriptor path, e.g. `sections[2].kinetic[0]` (an exit adds `.exit`). */
  path: string;
  /** Section-relative element reference, e.g. `kinetic[0]`, `graphics[1]`, `filters[2]`, `titleCard`. */
  element: string;
  /** The element's authored `id`, when it has one. */
  id?: string;
  kind: MotionKind;
  /** Section-local seconds. */
  start: number;
  end: number;
  /** Normalized curve name (springs carry their full parameters). */
  ease: string;
  visibleFrom: number;
  visibleUntil: number;
  /** Resting footprint in output px, when it can be computed without rendering. */
  bbox?: MotionBox;
  /** An entrance of an element (not an exit, a camera move, a hit or a transition). */
  entrance: boolean;
  /** The element is text. */
  text: boolean;
  /** Kinetic only: preset, seconds between the first and the last unit starting, and word count. */
  preset?: string;
  spread?: number;
  words?: number;
  /** The element keeps moving after its entrance until `visibleUntil` (wave, shake, Ken Burns). */
  continuous?: boolean;
}

export interface SectionTimeline {
  index: number;
  name: string;
  type: string;
  /** Section seconds (assumed when `durationKnown` is false). */
  duration: number;
  durationKnown: boolean;
  /** The transition into the next section, when the boundary is not a cut. */
  transition?: { type: string; duration: number; ease: string };
  events: MotionEvent[];
}

export interface MotionTimeline {
  width: number;
  height: number;
  fps: number;
  sections: SectionTimeline[];
}

/** What every element builder needs about the section it sits in. */
export interface ElementFrame {
  width: number;
  height: number;
  fps: number;
  duration: number;
  energy: number;
  /** `sections[i]`. */
  prefix: string;
}

function springKey(args: string[]): string {
  const [stiffness, damping, mass = '1', velocity = '0'] = args;

  return `spring(${stiffness},${damping},${mass},${velocity})`;
}

/** A comparable curve name: whitespace removed, spring defaults filled in, objects serialized. */
export function easeKey(spec: EasingSpec | undefined, fallback = 'linear'): string {
  if (spec === undefined) return fallback;

  if (typeof spec !== 'string') return `points${JSON.stringify((spec as { points?: unknown }).points ?? spec)}`;

  const compact = spec.replaceAll(/\s+/g, '');
  const spring = /^spring\((.*)\)$/.exec(compact);

  return spring ? springKey(spring[1].split(',')) : compact;
}

/** The text a timeline measures: English first, else the first non-empty locale. */
export function textOf(text: Record<string, string | undefined> | undefined): string {
  if (!text) return '';

  const values = [text.en, ...Object.values(text)].filter((value): value is string => typeof value === 'string');

  return values.find((value) => value.trim() !== '') ?? '';
}

export function authoredId(element: unknown): string | undefined {
  const id = (element as { id?: unknown } | null)?.id;

  return typeof id === 'string' && id !== '' ? id : undefined;
}

/**
 * A time field as seconds for the timeline. The timeline runs on the time-resolved descriptor, so a string
 * here is a reference the pass could not resolve (reported by validation); it falls back instead of throwing,
 * because pacing feedback is advisory.
 */
export function timeOf(value: number | string | undefined, fallback = 0): number {
  return typeof value === 'number' ? value : fallback;
}

export function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** The longest stretch of a section during which nothing animates (no element, camera or transition). */
export function longestStill(section: SectionTimeline): { from: number; to: number; length: number } {
  const spans = section.events
    .map((event) => [event.start, event.continuous ? event.visibleUntil : event.end] as const)
    .sort((a, b) => a[0] - b[0]);
  let best = { from: 0, to: 0, length: 0 };
  let cursor = 0;

  for (const [start, end] of [...spans, [section.duration, section.duration] as const]) {
    if (start - cursor > best.length) best = { from: round(cursor), to: round(start), length: round(start - cursor) };

    cursor = Math.max(cursor, end);
  }

  return best;
}
