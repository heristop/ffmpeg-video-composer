// `align: { sync, to }` on a partial ref: the section right before the ref is lengthened or shortened so
// the partial's sync point lands on `to` — a beat, a bar, a cue of an earlier section, or plain seconds —
// in whole-video time (the same assembly model the beat references use, transitions included). Runs on
// the fully expanded section list, in ref order, so a later align sees the earlier ones. Pure.

import { parseTimeRef, type TimeRef } from './timing/grammar';
import {
  barTime,
  beatTime,
  isAnalysisRequest,
  sectionStarts,
  type BeatsSpec,
  type TimelineSection,
} from './timing/timeline';
import { PartialError } from './partial-error';
import { fixedDuration } from './partial-envelope';
import type { PartialAlign } from '../schemas/partial.schemas';

type Bag = Record<string, unknown>;

export interface AlignRecord {
  /** Authored path of the ref, for findings. */
  path: string;
  align: PartialAlign;
  /** Expanded index of the ref's first section. */
  first: number;
  /** Expanded index of the section holding the sync point, and its local offset. */
  syncIndex: number;
  syncOffset: number;
}

interface GlobalView {
  beats?: BeatsSpec;
  transition?: { type: string; duration?: number };
}

const TOLERANCE = 1e-4;
const MIN_SECTION = 0.1;

function round(value: number): number {
  return Number(value.toFixed(6));
}

function fail(record: AlignRecord, code: string, message: string, hint?: string): never {
  throw new PartialError(`${record.path}.align`, code, message, hint);
}

function gridTarget(ref: Extract<TimeRef, { kind: 'beat' | 'bar' }>, global: GlobalView, record: AlignRecord): number {
  if (!global.beats) {
    fail(record, 'align_unresolvable', `"${ref.kind}:${ref.index}" needs global.beats`, 'add global.beats');
  }

  // Partials expand before the music is analyzed, so an align needs the grid written out.
  if (isAnalysisRequest(global.beats)) {
    fail(
      record,
      'align_unresolvable',
      'align cannot wait for global.beats { analyze: "music" }',
      'precompute the grid with `leclap beats <audio> --json` or the analyze_music MCP tool'
    );
  }

  const at = ref.kind === 'beat' ? beatTime(global.beats, ref.index) : barTime(global.beats, ref.index);

  if (at === null) fail(record, 'align_unresolvable', `global.beats has no ${ref.kind} ${ref.index}`);

  return at;
}

function cueTarget(name: string, sections: Bag[], starts: Array<number | null>, record: AlignRecord): number {
  const index = sections.findIndex((section) => Object.hasOwn(section.cues ?? {}, name));

  if (index === -1) fail(record, 'align_unknown_cue', `no section declares the cue "${name}"`);

  if (index > record.first - 1) {
    fail(record, 'align_unresolvable', `the cue "${name}" must sit in a section before the aligned partial`);
  }

  const start = starts[index];

  if (start === null) fail(record, 'align_unresolvable', `the start of the section holding "cue:${name}" is unknown`);

  return start + ((sections[index].cues as Record<string, number>)[name] ?? 0);
}

function targetTime(sections: Bag[], global: GlobalView, record: AlignRecord): number {
  const { to } = record.align;

  if (typeof to === 'number') return to;

  const ref = parseTimeRef(to);

  if (!ref || ref.kind === 'element' || ref.kind === 'percent' || ref.kind === 'end') {
    return fail(
      record,
      'align_unresolvable',
      `"${to}" is section-local; align needs "beat:n", "bar:n", "cue:name" or seconds`
    );
  }

  const starts = sectionStarts(sections as unknown as TimelineSection[], global.transition);
  const base = ref.kind === 'cue' ? cueTarget(ref.name, sections, starts, record) : gridTarget(ref, global, record);

  return base + ref.offset;
}

function syncTime(sections: Bag[], global: GlobalView, record: AlignRecord): number {
  const start = sectionStarts(sections as unknown as TimelineSection[], global.transition).at(record.syncIndex);

  if (start === null || start === undefined) {
    fail(
      record,
      'align_unresolvable',
      'the partial start is unknown before rendering',
      'set options.duration on every earlier section (a project_video clip has no known length)'
    );
  }

  return start + record.syncOffset;
}

function previousDuration(sections: Bag[], record: AlignRecord): number {
  const previous = record.first > 0 ? sections[record.first - 1] : undefined;
  const duration = previous ? fixedDuration(previous) : undefined;

  if (duration === undefined) {
    fail(
      record,
      'align_unresolvable',
      'align resizes the section right before the ref, which must exist and have options.duration',
      'put a section with a fixed duration before the partial'
    );
  }

  return duration;
}

function resize(sections: Bag[], index: number, duration: number): void {
  const section = sections[index];

  sections[index] = { ...section, options: { ...(section.options as Bag), duration: round(duration) } };
}

/** Applies one align in place on the expanded sections; throws a PartialError when it cannot land. */
export function applyAlign(sections: Bag[], global: GlobalView, record: AlignRecord): void {
  const target = targetTime(sections, global, record);

  // A transition's overlap depends on the lengths it joins, so settle in a few passes.
  for (let pass = 0; pass < 4; pass++) {
    const delta = target - syncTime(sections, global, record);

    if (Math.abs(delta) < TOLERANCE) return;

    const duration = previousDuration(sections, record) + delta;

    if (duration < MIN_SECTION) {
      fail(
        record,
        'align_unreachable',
        `the sync point "${record.align.sync}" already lands after ${round(target)}s; the previous section would need ${round(duration)}s`,
        'align to a later beat or cue, or shorten an earlier section'
      );
    }

    resize(sections, record.first - 1, duration);
  }

  if (Math.abs(target - syncTime(sections, global, record)) >= TOLERANCE) {
    fail(
      record,
      'align_unreachable',
      `the sync point "${record.align.sync}" could not be settled on ${round(target)}s`
    );
  }
}
