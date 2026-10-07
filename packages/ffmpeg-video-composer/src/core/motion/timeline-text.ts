// Timeline events for text sugar (titleCard, lowerThird, caption) and positioned drawtext filters
// (reveal, exit, animate tracks), with the same defaults the reveal lowering applies.

import { phaseDuration } from '../../editor/presets/eased-ramp';
import { measureBundled } from '../kinetic/layout';
import { LOWER_THIRD_STYLE_REVEALS, type LowerThirdStyle } from '../../schemas/text.schemas';
import { resolveKeyTimes, type TrackKey } from './tracks';
import type { EasingSpec } from './easing';
import {
  authoredId,
  easeKey,
  round,
  textOf,
  type ElementFrame,
  type MotionBox,
  type MotionEvent,
} from './timeline-model';

const REVEAL_DELAY = 0.3;
const PHASE_DURATION = 0.6;
const LINE_STAGGER = 0.15;

type Phase = { type: string; delay?: number; after?: number; duration?: number; easing?: EasingSpec };
type Translation = Record<string, string | undefined>;

function phase(input: unknown): Phase | null {
  const object = typeof input === 'string' ? { type: input } : (input as Phase | undefined);

  return object && object.type !== 'none' ? object : null;
}

function hasText(text: Translation | undefined): boolean {
  return textOf(text).trim() !== '';
}

interface TextElement {
  element: string;
  frame: ElementFrame;
  id?: string;
  bbox?: MotionBox;
}

function revealEvent(reveal: Phase, lines: number, stagger: number, target: TextElement): MotionEvent {
  const start = reveal.delay ?? REVEAL_DELAY;
  const end = start + Math.max(0, lines - 1) * stagger + phaseDuration(reveal.duration, reveal.easing, PHASE_DURATION);

  return {
    path: `${target.frame.prefix}.${target.element}`,
    element: target.element,
    ...(target.id && { id: target.id }),
    kind: 'reveal',
    start: round(start),
    end: round(end),
    ease: easeKey(reveal.easing),
    visibleFrom: round(start),
    visibleUntil: round(target.frame.duration),
    ...(target.bbox && { bbox: target.bbox }),
    entrance: true,
    text: true,
  };
}

interface SugarSection {
  titleCard?: {
    kicker?: Translation;
    headline?: Translation;
    subtitle?: Translation;
    reveal?: unknown;
    stagger?: number;
  };
  lowerThird?: { title?: Translation; subtitle?: Translation; reveal?: unknown; style?: LowerThirdStyle };
  caption?: { text?: Translation; reveal?: unknown };
}

interface SugarBlock {
  element: string;
  lines: Array<Translation | undefined>;
  reveal: unknown;
  stagger: number;
}

function sugarBlocks(section: SugarSection): SugarBlock[] {
  const { titleCard: card, lowerThird: band, caption } = section;

  return [
    ...(card
      ? [
          {
            element: 'titleCard',
            lines: [card.kicker, card.headline, card.subtitle],
            reveal: card.reveal ?? 'rise',
            stagger: card.stagger ?? LINE_STAGGER,
          },
        ]
      : []),
    ...(band
      ? [
          {
            element: 'lowerThird',
            lines: [band.title, band.subtitle],
            reveal: band.reveal ?? (band.style ? LOWER_THIRD_STYLE_REVEALS[band.style] : 'rise'),
            stagger: LINE_STAGGER,
          },
        ]
      : []),
    ...(caption ? [{ element: 'caption', lines: [caption.text], reveal: caption.reveal, stagger: 0 }] : []),
  ];
}

/** Entrances of the section's text sugar; caption has no default entrance, the blocks rise in. */
export function sugarEvents(section: SugarSection, frame: ElementFrame): MotionEvent[] {
  return sugarBlocks(section).flatMap((block) => {
    const lines = block.lines.filter(hasText).length;
    const reveal = phase(block.reveal);

    return lines > 0 && reveal ? [revealEvent(reveal, lines, block.stagger, { element: block.element, frame })] : [];
  });
}

interface DrawtextFilter {
  type?: string;
  values?: Record<string, unknown>;
  reveal?: unknown;
  exit?: unknown;
  animate?: Record<string, TrackKey[]>;
}

// A positioned drawtext's resting box: numeric x/y/fontsize and a bundled font's advances.
function drawtextBox(values: Record<string, unknown> | undefined): MotionBox | undefined {
  const { x, y, fontsize, fontfile, text } = values ?? {};

  if (typeof x !== 'number' || typeof y !== 'number' || typeof fontsize !== 'number') return undefined;

  const copy = typeof text === 'string' ? text : textOf(text as Translation | undefined);
  const width = typeof fontfile === 'string' ? measureBundled(fontfile, copy, fontsize) : null;

  return width === null ? undefined : { x, y, width: round(width), height: fontsize };
}

function animateEvent(animate: Record<string, TrackKey[]>, target: TextElement, entrance: boolean): MotionEvent | null {
  const timed = Object.values(animate)
    .filter(Array.isArray)
    .map((keys) => resolveKeyTimes(keys));
  const times = timed.flatMap((keys) => keys.map((key) => key.at));

  if (times.length === 0) return null;

  const ease = timed.flat().find((key) => key.ease !== undefined)?.ease;

  return {
    path: `${target.frame.prefix}.${target.element}.animate`,
    element: target.element,
    ...(target.id && { id: target.id }),
    kind: 'animate',
    start: round(Math.min(...times)),
    end: round(Math.max(...times)),
    ease: easeKey(ease),
    visibleFrom: round(entrance ? Math.min(...times) : 0),
    visibleUntil: round(target.frame.duration),
    ...(target.bbox && { bbox: target.bbox }),
    entrance,
    text: true,
  };
}

function exitEvent(exit: Phase, target: TextElement): MotionEvent {
  const duration = phaseDuration(exit.duration, exit.easing, PHASE_DURATION);
  const start = exit.after ?? Math.max(0, target.frame.duration - duration);

  return {
    path: `${target.frame.prefix}.${target.element}.exit`,
    element: target.element,
    ...(target.id && { id: target.id }),
    kind: 'exit',
    start: round(start),
    end: round(start + duration),
    ease: easeKey(exit.easing),
    visibleFrom: 0,
    visibleUntil: round(start + duration),
    entrance: false,
    text: true,
  };
}

function withExitBounds(events: MotionEvent[]): MotionEvent[] {
  const exit = events.find((event) => event.kind === 'exit');

  if (!exit) return events;

  const from = Math.min(...events.filter((event) => event.entrance).map((event) => event.start), exit.start);

  return events.map((event) =>
    event.kind === 'exit' ? { ...event, visibleFrom: round(from) } : { ...event, visibleUntil: exit.end }
  );
}

function filterEvents(filter: DrawtextFilter, index: number, frame: ElementFrame): MotionEvent[] {
  const target: TextElement = {
    element: `filters[${index}]`,
    frame,
    id: authoredId(filter),
    bbox: drawtextBox(filter.values),
  };
  const reveal = phase(filter.reveal);
  const exit = phase(filter.exit);
  const animate = filter.animate ? animateEvent(filter.animate, target, !reveal) : null;
  const events = [
    ...(reveal ? [revealEvent(reveal, 1, 0, target)] : []),
    ...(animate ? [animate] : []),
    ...(exit ? [exitEvent(exit, target)] : []),
  ];

  return withExitBounds(events);
}

/** Reveal, animate and exit events of the section's positioned drawtext filters. */
export function drawtextEvents(filters: readonly unknown[] | undefined, frame: ElementFrame): MotionEvent[] {
  return (filters ?? []).flatMap((filter, index) =>
    (filter as DrawtextFilter).type === 'drawtext' ? filterEvents(filter as DrawtextFilter, index, frame) : []
  );
}
