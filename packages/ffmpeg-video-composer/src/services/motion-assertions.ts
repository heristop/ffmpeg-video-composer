// Motion assertions (`section.assert`): checks an agent writes next to its choreography, proven against
// the motion timeline without rendering. A failure is a validation error (`assertion_failed`) that names
// the target and the measured value; an assertion that can't be measured render-free (an unmeasurable
// box, an undeclared section duration) is skipped and reported as an advisory `assertion_skipped`.

import type { MotionAssertion } from '../schemas/assert.schemas';
import { motionTimeline } from '@/core/motion/timeline';
import {
  authoredId,
  longestStill,
  type MotionEvent,
  type MotionTimeline,
  type SectionTimeline,
} from '@/core/motion/timeline-model';

// Structurally the validator's ValidationError (declared here so the rules module can import this one
// without a cycle, and without depending on fields other rules may add).
interface AssertionError {
  path: string;
  message: string;
  code: string;
}

interface SkippedAssertion {
  path: string;
  code: string;
  message: string;
  severity: 'info';
}

interface Outcome {
  path: string;
  status: 'fail' | 'skip';
  message: string;
}

type RawSection = Record<string, unknown> & { name?: string; assert?: MotionAssertion[] };

const TOLERANCE = 1e-6;
const ELEMENT_PATH = /^(kinetic|graphics|filters)\[(\d+)\]$/;
const SUGAR = new Set(['titleCard', 'lowerThird', 'caption']);

function fmt(seconds: number): string {
  return `${Number(seconds.toFixed(3))}s`;
}

// Whether the section holds the target at all, animated or not.
function exists(raw: RawSection, target: string): boolean {
  const match = ELEMENT_PATH.exec(target);

  if (match) return Array.isArray(raw[match[1]]) && (raw[match[1]] as unknown[]).length > Number(match[2]);

  if (SUGAR.has(target)) return raw[target] !== undefined;

  return ['kinetic', 'graphics', 'filters'].some((field) =>
    ((raw[field] as unknown[] | undefined) ?? []).some((element) => authoredId(element) === target)
  );
}

interface Entrance {
  start: number;
  end: number;
  events: MotionEvent[];
}

/** When the target starts and finishes entering; a static element is there from 0. Null when absent. */
function entranceOf(raw: RawSection, section: SectionTimeline, target: string): Entrance | null {
  const events = section.events.filter((event) => event.id === target || event.element === target);
  const entering = events.filter((event) => event.entrance);

  if (entering.length > 0) {
    return {
      start: Math.min(...entering.map((event) => event.start)),
      end: Math.max(...entering.map((event) => event.end)),
      events,
    };
  }

  return events.length > 0 || exists(raw, target) ? { start: 0, end: 0, events } : null;
}

interface Scope {
  raw: RawSection;
  section: SectionTimeline;
  timeline: MotionTimeline;
  path: string;
}

function missing(scope: Scope, kind: string, target: string): Outcome {
  return {
    path: scope.path,
    status: 'fail',
    message: `${kind}: "${target}" matches no element of section "${scope.section.name}" (use an id or a path like "kinetic[0]")`,
  };
}

function visibleBy(scope: Scope, check: { target: string; at: number }): Outcome | null {
  const entrance = entranceOf(scope.raw, scope.section, check.target);

  if (!entrance) return missing(scope, 'visibleBy', check.target);

  if (entrance.end <= check.at + TOLERANCE) return null;

  return {
    path: scope.path,
    status: 'fail',
    message: `visibleBy: "${check.target}" finishes entering at ${fmt(entrance.end)}, after the asserted ${fmt(check.at)}`,
  };
}

function before(scope: Scope, [a, b]: [string, string]): Outcome | null {
  const first = entranceOf(scope.raw, scope.section, a);
  const second = entranceOf(scope.raw, scope.section, b);

  if (!first) return missing(scope, 'before', a);

  if (!second) return missing(scope, 'before', b);

  if (first.end <= second.start + TOLERANCE) return null;

  return {
    path: scope.path,
    status: 'fail',
    message: `before: "${a}" finishes entering at ${fmt(first.end)} but "${b}" starts at ${fmt(second.start)}`,
  };
}

function inFrame(scope: Scope, target: string): Outcome | null {
  const entrance = entranceOf(scope.raw, scope.section, target);

  if (!entrance) return missing(scope, 'inFrame', target);

  const box = entrance.events.find((event) => event.bbox)?.bbox;
  const { width, height } = scope.timeline;

  if (!box) {
    return {
      path: scope.path,
      status: 'skip',
      message: `inFrame: "${target}" has no measurable box render-free; not checked`,
    };
  }

  const inside = box.x >= -1 && box.y >= -1 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1;

  if (inside) return null;

  const spans = `x ${Math.round(box.x)}–${Math.round(box.x + box.width)}, y ${Math.round(box.y)}–${Math.round(box.y + box.height)}`;

  return {
    path: scope.path,
    status: 'fail',
    message: `inFrame: "${target}" rests at ${spans}, outside the ${width}x${height} frame`,
  };
}

function keepsMoving(scope: Scope, maxStill: number): Outcome | null {
  const { section } = scope;

  if (!section.durationKnown) {
    return {
      path: scope.path,
      status: 'skip',
      message: `keepsMoving: section "${section.name}" declares no duration; not checked`,
    };
  }

  const still = longestStill(section);

  if (still.length <= maxStill + TOLERANCE) return null;

  return {
    path: scope.path,
    status: 'fail',
    message: `keepsMoving: section "${section.name}" is still for ${fmt(still.length)} (${fmt(still.from)}–${fmt(still.to)}), over the ${fmt(maxStill)} limit`,
  };
}

function evaluate(scope: Scope, assertion: MotionAssertion): Outcome | null {
  if ('visibleBy' in assertion) return visibleBy(scope, assertion.visibleBy);

  if ('before' in assertion) return before(scope, assertion.before);

  if ('inFrame' in assertion) return inFrame(scope, assertion.inFrame);

  return keepsMoving(scope, assertion.keepsMoving.maxStill);
}

function outcomes(descriptor: unknown, timeline?: MotionTimeline): Outcome[] {
  const sections = (descriptor as { sections?: RawSection[] } | null)?.sections ?? [];

  if (!sections.some((section) => Array.isArray(section.assert) && section.assert.length > 0)) return [];

  const resolved = timeline ?? motionTimeline(descriptor);

  return resolved.sections.flatMap((section) => {
    const raw = sections[section.index];

    return (raw.assert ?? []).flatMap((assertion, j) => {
      const outcome = evaluate(
        { raw, section, timeline: resolved, path: `sections[${section.index}].assert[${j}]` },
        assertion
      );

      return outcome ? [outcome] : [];
    });
  });
}

/** Failing assertions as validation errors (`assertion_failed`). */
export function validateAssertions(template: unknown): AssertionError[] {
  let measured: Outcome[];

  // An invalid curve is already reported by the motion rules; it must not hide them behind a throw.
  try {
    measured = outcomes(template);
  } catch {
    return [];
  }

  return measured
    .filter((outcome) => outcome.status === 'fail')
    .map(({ path, message }) => ({ path, message, code: 'assertion_failed' }));
}

/** Assertions that could not be measured render-free, as advisory findings. */
export function skippedAssertions(template: unknown, timeline: MotionTimeline): SkippedAssertion[] {
  return outcomes(template, timeline)
    .filter((outcome) => outcome.status === 'skip')
    .map(({ path, message }) => ({ path, message, code: 'assertion_skipped', severity: 'info' }));
}
