// The time-reference pass: every `"title.end + 0.2"`, `"50%"`, `"end - 0.5"`, `"beat:12"`, `"cue:drop"`
// in a section's time fields becomes plain seconds from the section start, once, before lowering. It runs
// right after motion tokens resolve (director/prepare-build.ts), and validation runs it too to report
// unknown ids, cycles, unresolvable anchors and negative times. Pure and deterministic.

import { nearestName, parseTimeRef, type TimeRef } from './grammar';
import {
  barTime,
  beatTime,
  isAnalysisRequest,
  knownDuration,
  sectionStarts,
  type BeatsSpec,
  type TimelineSection,
} from './timeline';
import { resolveSectionDurations } from './durations';
import { sectionElements, timeSlots, type ElementEntry, type TimeSlot } from './fields';
import { defaultStart, entranceSpan, type SpanContext } from './spans';
import { timingFrame, timingText, type TimingOptions } from './context';
import { resolveGlobalTimeRefs } from './global-refs';

export type { TimingOptions } from './context';

export type TimeIssueCode =
  | 'unknown_time_ref'
  | 'circular_time_ref'
  | 'unresolvable_time_ref'
  | 'negative_time'
  | 'duplicate_time_id'
  | 'beat_duration_needs_bpm'
  | 'beats_analysis_unavailable';

export interface TimeIssue {
  path: string;
  code: TimeIssueCode;
  message: string;
  hint?: string;
}

// A reference that waits for the music analysis (`global.beats: { analyze: 'music' }`): left as written,
// never reported, and resolved once the analysis has filled in the grid.
class DeferredTime extends Error {}

class TimeRefError extends Error {
  constructor(
    readonly code: TimeIssueCode,
    message: string,
    readonly hint?: string
  ) {
    super(message);
  }
}

interface Clock {
  ctx: SpanContext;
  /** Section start in the whole video, when known. */
  start: number | null;
  beats?: BeatsSpec;
  /** The section length is in beats and the grid awaits the analysis. */
  lengthDeferred: boolean;
  cues: Record<string, number>;
  elements: Map<string, ElementEntry>;
  starts: Map<string, number>;
}

type Bag = Record<string, unknown>;

function round(value: number): number {
  return Number(value.toFixed(6));
}

function sectionLength(clock: Clock): number {
  if (clock.ctx.duration !== undefined) return clock.ctx.duration;

  if (clock.lengthDeferred) throw new DeferredTime();

  throw new TimeRefError(
    'unresolvable_time_ref',
    'the section length is only known once its clip is probed',
    'set options.duration on this section, or use seconds'
  );
}

function gridTime(ref: Extract<TimeRef, { kind: 'beat' | 'bar' }>, clock: Clock): number {
  if (isAnalysisRequest(clock.beats)) throw new DeferredTime();

  if (!clock.beats) {
    throw new TimeRefError(
      'unresolvable_time_ref',
      `"${ref.kind}:${ref.index}" needs global.beats`,
      'add global.beats'
    );
  }

  if (clock.start === null) {
    throw new TimeRefError(
      'unresolvable_time_ref',
      'the section start is unknown before rendering (an earlier clip has no options.duration)',
      'set options.duration on every earlier section, or use seconds or a cue'
    );
  }

  const at = ref.kind === 'beat' ? beatTime(clock.beats, ref.index) : barTime(clock.beats, ref.index);

  if (at === null) throw new TimeRefError('unresolvable_time_ref', `global.beats has no ${ref.kind} ${ref.index}`);

  return at - clock.start;
}

function cueTime(name: string, clock: Clock): number {
  if (Object.hasOwn(clock.cues, name)) return clock.cues[name];

  const near = nearestName(name, Object.keys(clock.cues));

  throw new TimeRefError('unknown_time_ref', `no cue "${name}" in this section`, near && `did you mean "cue:${near}"?`);
}

function span(entry: ElementEntry, clock: Clock): number {
  try {
    return entranceSpan(entry, clock.ctx);
  } catch (error) {
    throw new TimeRefError('unresolvable_time_ref', `"${entry.id}" has no measurable entrance: ${String(error)}`);
  }
}

function elementStart(entry: ElementEntry, clock: Clock, stack: readonly string[]): number {
  const known = clock.starts.get(entry.id);

  if (known !== undefined) return known;

  if (stack.includes(entry.id)) {
    throw new TimeRefError('circular_time_ref', `circular time reference: ${[...stack, entry.id].join(' → ')}`);
  }

  const start = rawStart(entry, clock, [...stack, entry.id]);

  clock.starts.set(entry.id, start);

  return start;
}

function rawStart(entry: ElementEntry, clock: Clock, stack: readonly string[]): number {
  if (typeof entry.start === 'number') return entry.start;

  const ref = typeof entry.start === 'string' ? parseTimeRef(entry.start) : null;

  return ref ? refTime(ref, clock, stack) : defaultStart(entry);
}

function elementTime(ref: Extract<TimeRef, { kind: 'element' }>, clock: Clock, stack: readonly string[]): number {
  const entry = clock.elements.get(ref.id);

  if (!entry) {
    const near = nearestName(ref.id, clock.elements.keys());

    throw new TimeRefError(
      'unknown_time_ref',
      `no element with id "${ref.id}" in this section`,
      near && `did you mean "${near}.${ref.edge}"?`
    );
  }

  const start = elementStart(entry, clock, stack);

  return ref.edge === 'start' ? start : start + span(entry, clock);
}

function baseTime(ref: TimeRef, clock: Clock, stack: readonly string[]): number {
  if (ref.kind === 'element') return elementTime(ref, clock, stack);

  if (ref.kind === 'percent') return (sectionLength(clock) * ref.value) / 100;

  if (ref.kind === 'end') return sectionLength(clock);

  if (ref.kind === 'cue') return cueTime(ref.name, clock);

  return gridTime(ref, clock);
}

function refTime(ref: TimeRef, clock: Clock, stack: readonly string[]): number {
  return round(baseTime(ref, clock, stack) + ref.offset);
}

function slotTime(slot: TimeSlot, ref: TimeRef, clock: Clock): number {
  const owner = slot.owner === undefined ? undefined : clock.elements.get(slot.owner);

  // The field that starts an element resolves through that element, so a self-reference is a cycle.
  if (owner?.path === slot.path) return elementStart(owner, clock, []);

  return refTime(ref, clock, []);
}

function resolveSlot(slot: TimeSlot, clock: Clock, prefix: string): TimeIssue | null {
  // Relative keyframe times ("+0.3") and plain numbers in strings are not references; they lower as-is.
  const ref = parseTimeRef(slot.value);

  if (!ref) return null;

  try {
    const seconds = slotTime(slot, ref, clock);

    slot.write(seconds);

    return seconds < 0
      ? {
          path: `${prefix}${slot.path}`,
          code: 'negative_time',
          message: `"${slot.value}" resolves to ${seconds} s, before the section starts`,
          hint: 'move the anchor later or shrink the negative offset',
        }
      : null;
  } catch (error) {
    if (error instanceof DeferredTime) return null;

    if (!(error instanceof TimeRefError)) throw error;

    return { path: `${prefix}${slot.path}`, code: error.code, message: error.message, hint: error.hint };
  }
}

function elementTable(section: Bag, prefix: string, issues: TimeIssue[]): Map<string, ElementEntry> {
  const elements = new Map<string, ElementEntry>();

  for (const entry of sectionElements(section)) {
    if (elements.has(entry.id)) {
      issues.push({
        path: `${prefix}${entry.path.replace(/\.(delay|at|reveal\.delay)$/, '')}.id`,
        code: 'duplicate_time_id',
        message: `id "${entry.id}" is used twice in this section`,
        hint: 'give every referenced element its own id',
      });
      continue;
    }

    elements.set(entry.id, entry);
  }

  return elements;
}

interface PassContext {
  descriptor: { global?: unknown };
  options: TimingOptions;
  beats?: BeatsSpec;
  deferred: Set<number>;
}

function resolveSection(section: Bag, index: number, start: number | null, pass: PassContext): [Bag, TimeIssue[]] {
  const prefix = `sections[${index}].`;

  if (timeSlots(section).length === 0) return [section, []];

  const clone = structuredClone(section);
  const slots = timeSlots(clone);
  const issues: TimeIssue[] = [];
  const clock: Clock = {
    ctx: {
      frame: timingFrame(pass.descriptor, pass.options),
      duration: knownDuration(section as unknown as TimelineSection),
      text: timingText(pass.descriptor, section, pass.options),
    },
    start,
    beats: pass.beats,
    lengthDeferred: pass.deferred.has(index),
    cues: (section.cues ?? {}) as Record<string, number>,
    elements: elementTable(clone, prefix, issues),
    starts: new Map(),
  };

  for (const slot of slots) {
    const issue = resolveSlot(slot, clock, prefix);

    if (issue) issues.push(issue);
  }

  return [clone, issues];
}

// Outside validation, a grid that still awaits the music analysis is an error: only the Node compile can
// measure the music (it does so before this pass runs).
function analysisIssues(beats: BeatsSpec | undefined, options: TimingOptions): TimeIssue[] {
  if (!isAnalysisRequest(beats) || options.deferBeatsAnalysis) return [];

  return [
    {
      path: 'global.beats',
      code: 'beats_analysis_unavailable',
      message: 'global.beats { analyze: "music" } was not measured: only the Node compile can analyze music',
      hint: 'precompute the grid with `leclap beats <audio> --json` or the analyze_music MCP tool',
    },
  ];
}

/**
 * The descriptor with every section length in beats resolved to seconds (core/timing/durations.ts) and
 * every time reference in its sections resolved to seconds, and what could not be resolved. Sections
 * without references are returned untouched.
 */
export function resolveTimeRefs<T extends { global?: unknown; sections?: unknown }>(
  descriptor: T,
  options: TimingOptions = {}
): { descriptor: T; issues: TimeIssue[] } {
  if (!Array.isArray(descriptor.sections)) return { descriptor, issues: [] };

  const lengths = resolveSectionDurations(descriptor);
  const sections = lengths.descriptor.sections as Bag[];
  const global = (descriptor.global ?? {}) as { beats?: BeatsSpec; transition?: { type: string; duration?: number } };
  const starts = sectionStarts(sections as unknown as TimelineSection[], global.transition);
  const pass: PassContext = { descriptor, options, beats: global.beats, deferred: lengths.deferred };
  const issues: TimeIssue[] = [...lengths.issues, ...analysisIssues(global.beats, options)];
  const resolved = sections.map((section, index) => {
    const [out, found] = resolveSection(section, index, starts[index], pass);

    issues.push(...found);

    return out;
  });

  const globals = resolveGlobalTimeRefs(descriptor.global, sections);

  issues.push(...globals.issues);

  const resolvedGlobal = globals.global === descriptor.global ? {} : { global: globals.global };

  return { descriptor: { ...descriptor, ...resolvedGlobal, sections: resolved }, issues };
}
