// Time references on the WHOLE-VIDEO timeline: `global.sfx[].at` and `global.audio.automation[].at`. The
// grammar is the section one (grammar.ts) read at video scope: "<section>.start" / "<section>.end" name a
// section, "cue:<name>" the first section declaring that cue, "50%" / "end" the whole video, "beat:n" /
// "bar:n" the grid as is. Section starts come from the declared durations (timeline.ts), so a reference
// past a recorded clip without options.duration is unresolvable. Pure.

import { nearestName, parseTimeRef, type TimeRef } from './grammar';
import {
  barTime,
  beatTime,
  knownDuration,
  RENDERED,
  sectionStarts,
  type Beats,
  type TimelineSection,
} from './timeline';

type TimeIssueCode = 'unknown_time_ref' | 'unresolvable_time_ref' | 'negative_time';

/** Same shape as resolve.ts TimeIssue (kept local: resolve.ts imports this module). */
interface TimeIssue {
  path: string;
  code: TimeIssueCode;
  message: string;
  hint?: string;
}

type Bag = Record<string, unknown>;

interface VideoClock {
  sections: Array<{ name: string; start: number | null; duration: number | undefined; cues: Record<string, number> }>;
  beats?: Beats;
}

class GlobalRefError extends Error {
  constructor(
    readonly code: TimeIssueCode,
    message: string,
    readonly hint?: string
  ) {
    super(message);
  }
}

const UNKNOWN_START = 'set options.duration on every earlier section (a recorded clip is only measured at render)';

function known(value: number | null | undefined, what: string): number {
  if (value === null || value === undefined) {
    throw new GlobalRefError('unresolvable_time_ref', `${what} is only known once its clips are probed`, UNKNOWN_START);
  }

  return value;
}

function videoLength(clock: VideoClock): number {
  const last = clock.sections.at(-1);

  if (!last) throw new GlobalRefError('unresolvable_time_ref', 'the template has no rendered section');

  return known(last.start, 'the video length') + known(last.duration, 'the video length');
}

function sectionTime(ref: Extract<TimeRef, { kind: 'element' }>, clock: VideoClock): number {
  const section = clock.sections.find((candidate) => candidate.name === ref.id);

  if (!section) {
    const near = nearestName(
      ref.id,
      clock.sections.map((candidate) => candidate.name)
    );

    throw new GlobalRefError('unknown_time_ref', `no section named "${ref.id}"`, near && `did you mean "${near}"?`);
  }

  const start = known(section.start, `the start of "${ref.id}"`);

  return ref.edge === 'start' ? start : start + known(section.duration, `the length of "${ref.id}"`);
}

function cueTime(name: string, clock: VideoClock): number {
  const section = clock.sections.find((candidate) => Object.hasOwn(candidate.cues, name));

  if (!section) {
    const near = nearestName(
      name,
      clock.sections.flatMap((candidate) => Object.keys(candidate.cues))
    );

    throw new GlobalRefError(
      'unknown_time_ref',
      `no section declares cue "${name}"`,
      near && `did you mean "cue:${near}"?`
    );
  }

  return known(section.start, `the start of "${section.name}"`) + section.cues[name];
}

function gridTime(ref: Extract<TimeRef, { kind: 'beat' | 'bar' }>, clock: VideoClock): number {
  if (!clock.beats) throw new GlobalRefError('unresolvable_time_ref', `"${ref.kind}:${ref.index}" needs global.beats`);

  const at = ref.kind === 'beat' ? beatTime(clock.beats, ref.index) : barTime(clock.beats, ref.index);

  if (at === null) throw new GlobalRefError('unresolvable_time_ref', `global.beats has no ${ref.kind} ${ref.index}`);

  return at;
}

function baseTime(ref: TimeRef, clock: VideoClock): number {
  if (ref.kind === 'element') return sectionTime(ref, clock);

  if (ref.kind === 'cue') return cueTime(ref.name, clock);

  if (ref.kind === 'percent') return (videoLength(clock) * ref.value) / 100;

  if (ref.kind === 'end') return videoLength(clock);

  return gridTime(ref, clock);
}

function resolveAt(owner: Bag, path: string, clock: VideoClock): TimeIssue | null {
  const ref = typeof owner.at === 'string' ? parseTimeRef(owner.at) : null;

  if (!ref) return null;

  try {
    const seconds = Number((baseTime(ref, clock) + ref.offset).toFixed(6));

    owner.at = seconds;

    return seconds < 0
      ? { path, code: 'negative_time', message: `resolves to ${seconds} s, before the video starts` }
      : null;
  } catch (error) {
    if (!(error instanceof GlobalRefError)) throw error;

    return { path, code: error.code, message: error.message, hint: error.hint };
  }
}

function videoClock(sections: readonly Bag[], global: Bag): VideoClock {
  const timeline = sections as unknown as TimelineSection[];
  const starts = sectionStarts(timeline, global.transition as { type: string; duration?: number } | undefined);

  return {
    beats: global.beats as Beats | undefined,
    sections: sections.flatMap((section, index) =>
      RENDERED.has(timeline[index].type)
        ? [
            {
              name: typeof section.name === 'string' ? section.name : '',
              start: starts[index],
              duration: knownDuration(timeline[index]),
              cues: (section.cues ?? {}) as Record<string, number>,
            },
          ]
        : []
    ),
  };
}

function lists(global: Bag): Array<{ items: unknown; path: string }> {
  const audio = (global.audio ?? {}) as Bag;

  return [
    { items: global.sfx, path: 'global.sfx' },
    { items: audio.automation, path: 'global.audio.automation' },
  ];
}

/** `global` with its whole-video time references resolved to seconds (a clone when any changed). */
export function resolveGlobalTimeRefs(
  global: unknown,
  sections: readonly Bag[]
): { global: unknown; issues: TimeIssue[] } {
  if (global === null || typeof global !== 'object') return { global, issues: [] };

  const timed = lists(global as Bag).some(
    ({ items }) => Array.isArray(items) && items.some((item) => typeof (item as Bag | null)?.at === 'string')
  );

  if (!timed) return { global, issues: [] };

  const clone = structuredClone(global) as Bag;
  const clock = videoClock(sections, clone);
  const issues = lists(clone).flatMap(({ items, path }) =>
    (Array.isArray(items) ? (items as Bag[]) : []).flatMap((item, i) => {
      const issue = resolveAt(item, `${path}[${i}].at`, clock);

      return issue ? [issue] : [];
    })
  );

  return { global: clone, issues };
}
