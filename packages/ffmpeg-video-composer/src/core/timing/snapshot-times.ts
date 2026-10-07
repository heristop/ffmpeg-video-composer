// Which moments of a video to look at: the snapshot planner behind `leclap snapshot` and the MCP
// `render_frames` tool. A moment is plain seconds or a time reference read on the WHOLE video —
// "intro.end" (a section or an element id), "beat:8", "50%" (of the video), "cue:drop + 0.1" — plus
// the generated ones: either side of every section boundary, and the moment each section has settled.
// Pure; the render-side helper (services/snapshot-node.ts) grabs the frames.

import { nearestName, parseTimeRef, type TimeRef } from './grammar';
import { barTime, beatTime, type Beats } from './timeline';
import { sectionAt, videoTimeline, type VideoTimeline } from './video-timeline';

export type SnapshotTime = number | string;

export interface SnapshotPlan {
  /** Explicit moments: seconds, or a time reference on the whole video. */
  at?: readonly SnapshotTime[];
  /** Each section boundary, 0.1 s before and 0.2 s after the cut. */
  atTransitions?: boolean;
  /** Each section once its last kinetic / graphic entrance has landed (+0.2 s). */
  perSection?: boolean;
}

export interface SnapshotMoment {
  /** Absolute seconds, snapped onto the frame grid. */
  time: number;
  label: string;
  /** The section on screen. */
  section: string;
  source: 'at' | 'transition' | 'section';
}

const BEFORE_CUT = 0.1;
const AFTER_CUT = 0.2;
const SETTLE = 0.2;
const SETTLING_KINDS = new Set(['kinetic', 'graphic', 'reveal']);
const EDGE = /^(.+)\.(start|end)(?:\s*([+-])\s*(\d+(?:\.\d+)?))?$/;
const SECONDS = /^\s*(\d+(?:\.\d+)?)\s*s?\s*$/;

export class SnapshotTimeError extends Error {}

interface Context {
  timeline: VideoTimeline;
  beats?: Beats;
}

function sectionEdge(text: string, timeline: VideoTimeline): number | null {
  const match = EDGE.exec(text.trim());
  const section = match ? timeline.sections.find((entry) => entry.name === match[1]) : undefined;

  if (!match || !section) return null;

  const magnitude = match.at(4);
  const offset = magnitude === undefined ? 0 : Number(magnitude) * (match.at(3) === '-' ? -1 : 1);

  return (match[2] === 'start' ? section.start : section.end) + offset;
}

function elementTime(ref: Extract<TimeRef, { kind: 'element' }>, timeline: VideoTimeline): number {
  const named = timeline.events.filter((event) => event.id === ref.id);
  const event = named.find((entry) => entry.entrance) ?? named.at(0);

  if (!event) {
    const candidates = [...timeline.sections.map((s) => s.name), ...timeline.events.flatMap((e) => e.id ?? [])];
    const near = nearestName(ref.id, candidates);

    throw new SnapshotTimeError(`no section or element "${ref.id}"${near ? `; did you mean "${near}"?` : ''}`);
  }

  return ref.edge === 'start' ? event.start : event.end;
}

function gridTime(ref: Extract<TimeRef, { kind: 'beat' | 'bar' }>, beats: Beats | undefined): number {
  if (!beats) throw new SnapshotTimeError(`"${ref.kind}:${ref.index}" needs global.beats`);

  const at = ref.kind === 'beat' ? beatTime(beats, ref.index) : barTime(beats, ref.index);

  if (at === null) throw new SnapshotTimeError(`global.beats has no ${ref.kind} ${ref.index}`);

  return at;
}

function cueTime(name: string, timeline: VideoTimeline): number {
  const cue = timeline.cues.find((entry) => entry.name === name);

  if (!cue) throw new SnapshotTimeError(`no cue "${name}" in any section`);

  return cue.time;
}

function refTime(ref: TimeRef, context: Context): number {
  const { timeline } = context;

  if (ref.kind === 'element') return elementTime(ref, timeline);

  if (ref.kind === 'percent') return (timeline.duration * ref.value) / 100;

  if (ref.kind === 'end') return timeline.duration;

  if (ref.kind === 'cue') return cueTime(ref.name, timeline);

  return gridTime(ref, context.beats);
}

function referenceTime(text: string, context: Context): number {
  const seconds = SECONDS.exec(text);

  if (seconds) return Number(seconds[1]);

  const edge = sectionEdge(text, context.timeline);

  if (edge !== null) return edge;

  const ref = parseTimeRef(text);

  if (!ref) {
    throw new SnapshotTimeError(
      `"${text}" is not a time: use seconds, "<section>.start|end", "<id>.start|end", "<n>%", "end", "beat:<n>", "bar:<n>" or "cue:<name>"`
    );
  }

  return refTime(ref, context) + ref.offset;
}

/** Keep a moment on a frame the video actually has: inside [0, last frame], on the frame grid. */
export function snapTime(time: number, timeline: Pick<VideoTimeline, 'duration' | 'fps'>): number {
  const frame = 1 / timeline.fps;
  const last = Math.max(0, timeline.duration - frame);
  const clamped = Math.min(Math.max(0, time), last);

  return Number((Math.floor(clamped * timeline.fps + 1e-6) / timeline.fps).toFixed(6));
}

/** Absolute seconds of one snapshot time (seconds or a whole-video time reference), not yet snapped. */
export function resolveSnapshotTime(input: SnapshotTime, descriptor: unknown, timeline?: VideoTimeline): number {
  if (typeof input === 'number') return input;

  const view = (descriptor ?? {}) as { global?: { beats?: Beats } };

  return referenceTime(input, { timeline: timeline ?? videoTimeline(descriptor), beats: view.global?.beats });
}

function moment(time: number, label: string, source: SnapshotMoment['source'], timeline: VideoTimeline) {
  const snapped = snapTime(time, timeline);

  return { time: snapped, label, section: sectionAt(timeline, snapped)?.name ?? '', source };
}

function transitionMoments(timeline: VideoTimeline): SnapshotMoment[] {
  return timeline.sections.slice(1).flatMap((section, i) => {
    const cut = `${timeline.sections[i].name}>${section.name}`;

    return [
      moment(section.start - BEFORE_CUT, `${cut} -${BEFORE_CUT}`, 'transition', timeline),
      moment(section.start + AFTER_CUT, `${cut} +${AFTER_CUT}`, 'transition', timeline),
    ];
  });
}

function settledMoments(timeline: VideoTimeline): SnapshotMoment[] {
  return timeline.sections.map((section) => {
    const landed = timeline.events
      .filter((event) => event.section === section.name && event.entrance && SETTLING_KINDS.has(event.kind))
      .map((event) => event.end);
    const settled = landed.length > 0 ? Math.max(...landed) + SETTLE : section.start + section.duration / 2;
    const inside = Math.min(settled, section.end - 1 / timeline.fps);

    return { ...moment(inside, `${section.name} settled`, 'section', timeline), section: section.name };
  });
}

function explicitMoments(at: readonly SnapshotTime[], descriptor: unknown, timeline: VideoTimeline) {
  return at.map((input) => {
    const time = resolveSnapshotTime(input, descriptor, timeline);
    const label = typeof input === 'number' ? `${input}s` : input.trim();

    return moment(time, label, 'at', timeline);
  });
}

/**
 * Every moment to grab, in time order, one per frame (a frame asked for twice is grabbed once). Throws
 * SnapshotTimeError for a time it cannot place. With no option at all, it plans `perSection`.
 */
export function snapshotMoments(
  descriptor: unknown,
  plan: SnapshotPlan,
  timeline: VideoTimeline = videoTimeline(descriptor)
): SnapshotMoment[] {
  const nothing = !plan.at?.length && !plan.atTransitions && !plan.perSection;
  const moments = [
    ...explicitMoments(plan.at ?? [], descriptor, timeline),
    ...(plan.atTransitions ? transitionMoments(timeline) : []),
    ...(plan.perSection || nothing ? settledMoments(timeline) : []),
  ];
  const seen = new Set<number>();

  return moments
    .sort((a, b) => a.time - b.time)
    .filter((entry) => !seen.has(entry.time) && Boolean(seen.add(entry.time)));
}
