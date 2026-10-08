// The whole-video timeline: every rendering section placed at its absolute start, every motion event of
// the motion timeline moved onto video seconds, the beat grid and the named cues. Pure and render-free,
// so an agent can ask "what is on screen at 4.2 s" (`leclap timeline --json`, MCP `validate_template` include timeline) and the
// snapshot planner can turn "intro.end" or "beat:8" into a time to grab a frame at.

import { motionTimeline, type MotionEvent, type SectionTimeline } from '../motion/timeline';
import { resolveSectionDurations } from './durations';
import { beatTime, knownDuration, sectionStarts, type Beats, type TimelineSection } from './timeline';

export interface VideoTimelineSection {
  /** Index in the descriptor's `sections`. */
  index: number;
  name: string;
  type: string;
  /** Absolute seconds in the final video. */
  start: number;
  end: number;
  duration: number;
  /** False when the section length is assumed (a clip whose length is only known once probed). */
  durationKnown: boolean;
  /** The transition into the next section, when the boundary is not a cut. */
  transition?: { type: string; duration: number; ease: string };
}

export interface VideoTimelineEvent extends MotionEvent {
  /** Name of the section the event belongs to. */
  section: string;
}

export interface VideoTimelineBeat {
  /** 1-based beat number on the global grid. */
  beat: number;
  time: number;
  /** First beat of a bar. */
  downbeat: boolean;
}

export interface VideoTimelineCue {
  section: string;
  name: string;
  time: number;
}

export interface VideoTimeline {
  width: number;
  height: number;
  fps: number;
  /** Seconds of the whole video. */
  duration: number;
  /** True when a section length was assumed, so later starts are estimates. */
  approx: boolean;
  sections: VideoTimelineSection[];
  /** Every motion event on absolute seconds, sorted by start. */
  events: VideoTimelineEvent[];
  beats: VideoTimelineBeat[];
  cues: VideoTimelineCue[];
}

interface LooseDescriptor {
  global?: { beats?: Beats };
  sections?: Array<TimelineSection & { cues?: Record<string, number> }>;
}

/** No grid lists more beats than this (a 10-minute video at 200 BPM). */
const MAX_BEATS = 2000;

function round(value: number): number {
  return Number(value.toFixed(6));
}

// The motion timeline already knows each section's (possibly assumed) length and outgoing transition;
// placing those lengths with the director's overlap rule gives every start.
function absoluteStarts(sections: readonly SectionTimeline[]): number[] {
  const placed: TimelineSection[] = sections.map((section) => ({
    type: 'video',
    options: { duration: section.duration },
    transition: section.transition ?? { type: 'cut' },
  }));

  return sectionStarts(placed).map((start) => start ?? 0);
}

function moved(event: MotionEvent, start: number, section: string): VideoTimelineEvent {
  return {
    ...event,
    section,
    start: round(event.start + start),
    end: round(event.end + start),
    visibleFrom: round(event.visibleFrom + start),
    visibleUntil: round(event.visibleUntil + start),
  };
}

function beatGrid(beats: Beats | undefined, duration: number): VideoTimelineBeat[] {
  if (!beats) return [];

  const perBar = beats.beatsPerBar ?? 4;
  const grid: VideoTimelineBeat[] = [];

  for (let beat = 1; beat <= MAX_BEATS; beat++) {
    const time = beatTime(beats, beat);

    if (time === null || time > duration) break;

    grid.push({ beat, time: round(time), downbeat: (beat - 1) % perBar === 0 });
  }

  return grid;
}

function sectionCues(descriptor: LooseDescriptor, section: VideoTimelineSection): VideoTimelineCue[] {
  const cues = descriptor.sections?.[section.index]?.cues ?? {};

  return Object.entries(cues)
    .filter(([, time]) => typeof time === 'number')
    .map(([name, time]) => ({ section: section.name, name, time: round(section.start + time) }));
}

// A clip's kept windows or trimmed range fix its length before any probe (core/timing/timeline.ts).
function withKnownLengths<T extends { sections: SectionTimeline[] }>(motion: T, descriptor: LooseDescriptor): T {
  const sections = motion.sections.map((section) => {
    const raw = descriptor.sections?.[section.index];
    const known = raw ? knownDuration(raw) : undefined;

    return known === undefined ? section : { ...section, duration: known, durationKnown: true };
  });

  return { ...motion, sections };
}

/**
 * The template on video seconds: sections with absolute start/end, every motion event, beats and cues.
 * Pass the partial-expanded descriptor (what validation returns), so indices match the rendered video.
 */
export function videoTimeline(descriptor: unknown): VideoTimeline {
  const loose = resolveSectionDurations((descriptor ?? {}) as LooseDescriptor).descriptor;
  const motion = withKnownLengths(motionTimeline(loose), loose);
  const starts = absoluteStarts(motion.sections);
  const sections: VideoTimelineSection[] = motion.sections.map((section, i) => ({
    index: section.index,
    name: section.name,
    type: section.type,
    start: round(starts[i]),
    end: round(starts[i] + section.duration),
    duration: section.duration,
    durationKnown: section.durationKnown,
    ...(section.transition && { transition: section.transition }),
  }));
  const duration = Math.max(0, ...sections.map((section) => section.end));
  const events = motion.sections
    .flatMap((section, i) => section.events.map((event) => moved(event, starts[i], section.name)))
    .sort((a, b) => a.start - b.start);

  return {
    width: motion.width,
    height: motion.height,
    fps: motion.fps,
    duration,
    approx: sections.some((section) => !section.durationKnown),
    sections,
    events,
    beats: beatGrid(loose.global?.beats, duration),
    cues: sections.flatMap((section) => sectionCues(loose, section)),
  };
}

/** The section on screen at `time` (the later one inside a transition overlap). */
export function sectionAt(timeline: VideoTimeline, time: number): VideoTimelineSection | undefined {
  return timeline.sections.findLast((section) => section.start <= time + 1e-6) ?? timeline.sections.at(0);
}
