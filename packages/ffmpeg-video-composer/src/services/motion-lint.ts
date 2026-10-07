// Pacing lint: advisory findings read off the motion timeline. Like the geometry warnings they never
// enter `errors` and never flip `success` — a template with flat pacing still renders — they tell an
// agent what a motion designer would change, each with a one-line hint.

import { motionTimeline } from '@/core/motion/timeline';
import { longestStill, type MotionEvent, type SectionTimeline } from '@/core/motion/timeline-model';
import { expandPartialsSafe } from '@/core/partials';
import { skippedAssertions } from './motion-assertions';
import { roleWarnings } from './motion-roles-lint';
import { samenessWarnings } from './sameness-lint';

export interface MotionWarning {
  path: string;
  code: string;
  message: string;
  /** `warn` for pacing findings; `info` when an assertion could not be checked render-free. */
  severity: 'warn' | 'info';
  hint?: string;
}

/** More independent elements than this on one curve reads as a template, not direction. */
export const EASE_MONOTONY_LIMIT = 2;
/** front_loaded: this share of entrances done within the first FRONT_LOAD_WINDOW of the section. */
export const FRONT_LOAD_SHARE = 0.8;
export const FRONT_LOAD_WINDOW = 0.25;
export const FRONT_LOAD_MIN_SECTION = 3;
export const FRONT_LOAD_MIN_ENTRANCES = 2;
/** A kinetic block of at most this many words is a headline; its units should all start within the spread. */
export const HEADLINE_MAX_WORDS = 6;
export const HEADLINE_MAX_SPREAD = 0.6;
export const ZERO_START_EPSILON = 0.001;
export const TRANSITION_MONOTONY_MIN_BOUNDARIES = 4;
/** An exit ending this close to a designed or crossfaded boundary is doing the transition's job. */
export const EXIT_TRANSITION_WINDOW = 0.3;
export const DEAD_AIR_SECONDS = 2.5;
export const TEMPO_MIN_RATIO = 1.5;
export const TEMPO_MIN_SECTIONS = 4;

/** Presets whose linear stepping is the effect itself (exempt from curve and stagger rules). */
const STEPPED_PRESETS = new Set(['typewriter', 'scramble']);
const STILL_BACKGROUNDS = new Set(['color_background', 'image_background']);
/** Camera "curves" that are not curves: punches, shake and Ken Burns; and a subtitle track's karaoke. */
const NOT_A_CURVE = new Set(['hit', 'shake', 'kenburns', 'karaoke']);

function warn(path: string, code: string, message: string, hint: string): MotionWarning {
  return { path, code, message, severity: 'warn', hint };
}

function s(seconds: number): string {
  return `${Number(seconds.toFixed(2))}s`;
}

function label(section: SectionTimeline): string {
  return `Section "${section.name}"`;
}

function curvedElements(section: SectionTimeline): MotionEvent[] {
  const seen = new Set<string>();

  return section.events.filter((event) => {
    const counts = event.kind !== 'exit' && event.kind !== 'transition' && !NOT_A_CURVE.has(event.ease);
    const key = `${event.element}:${event.kind === 'camera' ? event.path : ''}`;

    if (!counts || STEPPED_PRESETS.has(event.preset ?? '') || seen.has(key)) return false;

    seen.add(key);

    return true;
  });
}

function easeMonotony(section: SectionTimeline): MotionWarning[] {
  const groups = Map.groupBy(curvedElements(section), (event) => event.ease);

  return [...groups].flatMap(([ease, events]) =>
    events.length > EASE_MONOTONY_LIMIT
      ? [
          warn(
            `sections[${section.index}]`,
            'ease_monotony',
            `${label(section)}: ${events.length} elements share the curve ${ease} (${events.map((e) => e.element).join(', ')})`,
            'Vary curves by role: a spring for the hero, a smooth expo for supporting copy, a linear draw for rules.'
          ),
        ]
      : []
  );
}

function frontLoaded(section: SectionTimeline): MotionWarning[] {
  if (!section.durationKnown || section.duration < FRONT_LOAD_MIN_SECTION) return [];

  const entrances = section.events.filter((event) => event.entrance);
  const cutoff = section.duration * FRONT_LOAD_WINDOW;
  const early = entrances.filter((event) => event.end <= cutoff).length;

  if (entrances.length < FRONT_LOAD_MIN_ENTRANCES || early / entrances.length < FRONT_LOAD_SHARE) return [];

  return [
    warn(
      `sections[${section.index}]`,
      'front_loaded',
      `${label(section)}: ${early} of ${entrances.length} entrances land by ${s(cutoff)} of a ${s(section.duration)} section, then nothing new arrives`,
      'Reveal sequentially through the back half: delay supporting elements, or shorten the section.'
    ),
  ];
}

function staggerTooLong(section: SectionTimeline): MotionWarning[] {
  return section.events
    .filter((event) => event.kind === 'kinetic' && !STEPPED_PRESETS.has(event.preset ?? ''))
    .filter((event) => (event.words ?? 0) <= HEADLINE_MAX_WORDS && (event.spread ?? 0) > HEADLINE_MAX_SPREAD)
    .map((event) =>
      warn(
        event.path,
        'stagger_too_long',
        `${event.element}: its units start over ${s(event.spread ?? 0)} for a ${event.words}-word headline`,
        'Keep a headline stagger under 0.6 s: lower stagger (0.04–0.08 per word) or animate by word or line.'
      )
    );
}

function startsAtZero(section: SectionTimeline, position: number): MotionWarning[] {
  const first = section.events
    .filter((event) => event.entrance && event.text)
    .sort((a, b) => a.start - b.start)
    .at(0);

  if (position === 0 || !first || first.start > ZERO_START_EPSILON) return [];

  return [
    warn(
      first.path,
      'starts_at_zero',
      `${label(section)}: ${first.element} starts entering on the cut (t=0)`,
      'Offset the first text entrance by 0.1–0.3 s so the cut lands before the copy moves.'
    ),
  ];
}

function exitBeforeTransition(section: SectionTimeline): MotionWarning[] {
  const transition = section.transition;

  if (!transition) return [];

  return section.events
    .filter((event) => event.kind === 'exit' && event.end >= section.duration - EXIT_TRANSITION_WINDOW)
    .map((event) =>
      warn(
        event.path,
        'exit_before_transition',
        `${event.element} exits in the last ${EXIT_TRANSITION_WINDOW}s before a "${transition.type}" transition`,
        'Drop the exit: the transition is the exit. Keep exits for hard cuts or mid-section changes.'
      )
    );
}

function deadAir(section: SectionTimeline): MotionWarning[] {
  if (!section.durationKnown || !STILL_BACKGROUNDS.has(section.type)) return [];

  const still = longestStill(section);

  if (still.length < DEAD_AIR_SECONDS) return [];

  return [
    warn(
      `sections[${section.index}]`,
      'dead_air',
      `${label(section)}: nothing moves for ${s(still.length)} (${s(still.from)}–${s(still.to)})`,
      'Add a slow camera move (push-in, drift), a late supporting reveal, or shorten the section.'
    ),
  ];
}

function transitionMonotony(sections: SectionTimeline[]): MotionWarning[] {
  const boundaries = sections.slice(0, -1).map((section) => section.transition?.type ?? 'cut');
  const [first] = boundaries;

  if (boundaries.length < TRANSITION_MONOTONY_MIN_BOUNDARIES || first === 'cut') return [];

  if (boundaries.some((type) => type !== first)) return [];

  return [
    warn(
      'sections',
      'transition_monotony',
      `All ${boundaries.length} boundaries use "${first}"`,
      'Pick one primary transition and 1–2 accents for the key moments; cut between beats of the same idea.'
    ),
  ];
}

function tempoFlat(sections: SectionTimeline[]): MotionWarning[] {
  const durations = sections.filter((section) => section.durationKnown).map((section) => section.duration);

  if (durations.length < TEMPO_MIN_SECTIONS) return [];

  const [fastest, slowest] = [Math.min(...durations), Math.max(...durations)];

  if (slowest / fastest >= TEMPO_MIN_RATIO) return [];

  return [
    warn(
      'sections',
      'tempo_flat',
      `Section lengths only range ${s(fastest)}–${s(slowest)} (×${(slowest / fastest).toFixed(2)})`,
      'Vary the beat: quick hooks, held reveals — let the slowest beat run about 3× the fastest.'
    ),
  ];
}

function sectionWarnings(section: SectionTimeline, position: number): MotionWarning[] {
  return [
    ...easeMonotony(section),
    ...frontLoaded(section),
    ...staggerTooLong(section),
    ...startsAtZero(section, position),
    ...exitBeforeTransition(section),
    ...deadAir(section),
  ];
}

/** Every pacing finding, plus the assertions that could not be checked render-free. Never throws. */
export function collectMotionWarnings(template: unknown): MotionWarning[] {
  const expansion = expandPartialsSafe(template);

  if (!expansion.ok) return [];

  // The sameness lint reads the descriptor, not the timeline: it holds even when timing cannot be resolved.
  return [...timelineWarnings(expansion.data), ...samenessWarnings(expansion.data)];
}

function timelineWarnings(data: unknown): MotionWarning[] {
  try {
    const timeline = motionTimeline(data);

    return [
      ...timeline.sections.flatMap((section, position) => sectionWarnings(section, position)),
      ...transitionMonotony(timeline.sections),
      ...tempoFlat(timeline.sections),
      ...skippedAssertions(data, timeline),
      ...roleWarnings(data, timeline),
    ];
  } catch {
    return [];
  }
}
