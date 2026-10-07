// Advisory findings about motion roles and section intent, read off the motion timeline like the pacing
// lint (motion-lint.ts registers them):
//
// - overshoot_overuse: more than half of a section's entrances (at least 3) overshoot their target.
// - headline_hold_short: a headline lands and leaves (or the section cuts) before it can be read.
// - section_without_purpose: a rendering section without `purpose`, only when the template opts in
//   (meta.brief or meta.requirePurpose: true).

import { curveOvershoot, headlineHoldSeconds } from '@/core/motion/roles';
import { textOf, type MotionEvent, type SectionTimeline } from '@/core/motion/timeline-model';
import { RENDERING_SECTION_TYPES, type MotionTimeline } from '@/core/motion/timeline';

/** Same shape as motion-lint's MotionWarning (declared here so the two modules don't import each other). */
export interface RoleWarning {
  path: string;
  code: string;
  message: string;
  severity: 'warn';
  hint: string;
}

/** A curve overshooting by more than this (1%) counts as overshooting. */
export const OVERSHOOT_THRESHOLD = 0.01;
export const OVERSHOOT_MIN_ENTRANCES = 3;
/** Kinetic presets the catalog recommends for headlines: checked for hold even without `role`. */
export const HEADLINE_PRESETS = new Set(['cascade', 'rise', 'tracking-in', 'split']);

type Loose = Record<string, unknown>;
type Translation = Record<string, string | undefined>;

function warn(path: string, code: string, message: string, hint: string): RoleWarning {
  return { path, code, message, severity: 'warn', hint };
}

function s(seconds: number): string {
  return `${Number(seconds.toFixed(2))}s`;
}

/** The authored element an event points at (`kinetic[0]`, `titleCard`, `filters[2]`…). */
function elementOf(section: Loose | undefined, element: string): Loose | undefined {
  const indexed = /^(\w+)\[(\d+)\]$/.exec(element);
  const value = indexed ? (section?.[indexed[1]] as unknown[] | undefined)?.[Number(indexed[2])] : section?.[element];

  return value !== null && typeof value === 'object' ? (value as Loose) : undefined;
}

function entrances(section: SectionTimeline): MotionEvent[] {
  const seen = new Set<string>();

  return section.events.filter((event) => {
    if (!event.entrance || event.kind === 'camera' || seen.has(event.element)) return false;

    seen.add(event.element);

    return true;
  });
}

function overshootOveruse(section: SectionTimeline): RoleWarning[] {
  const list = entrances(section);
  const overshooting = list.filter((event) => curveOvershoot(event.ease) > OVERSHOOT_THRESHOLD);

  if (list.length < OVERSHOOT_MIN_ENTRANCES || overshooting.length * 2 <= list.length) return [];

  return [
    warn(
      `sections[${section.index}]`,
      'overshoot_overuse',
      `Section "${section.name}": ${overshooting.length} of ${list.length} entrances overshoot (${overshooting.map((e) => e.element).join(', ')})`,
      'Keep overshoot for one or two playful elements; micro/panels settle (role: micro or panel, or $expo / $smooth).'
    ),
  ];
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

// Words of a headline element: the kinetic word count, else the copy its role headlines.
function headlineWords(event: MotionEvent, element: Loose | undefined): number {
  if (event.words !== undefined) return event.words;

  const values = element?.values as Loose | undefined;
  const copy = element?.headline ?? element?.title ?? values?.text;

  return wordCount(typeof copy === 'string' ? copy : textOf(copy as Translation | undefined));
}

function isHeadline(event: MotionEvent, element: Loose | undefined): boolean {
  if (!event.entrance || (event.kind !== 'kinetic' && event.kind !== 'reveal')) return false;

  const role = element?.role;

  if (role !== undefined) return role === 'headline';

  return event.kind === 'kinetic' && HEADLINE_PRESETS.has(event.preset ?? '');
}

function headlineHoldShort(section: SectionTimeline, authored: Loose | undefined): RoleWarning[] {
  return section.events.flatMap((event) => {
    const element = elementOf(authored, event.element);

    if (!isHeadline(event, element)) return [];

    const exit = section.events.find((other) => other.kind === 'exit' && other.element === event.element);

    if (!exit && !section.durationKnown) return [];

    const hold = (exit?.start ?? section.duration) - event.end;
    const words = headlineWords(event, element);
    const needed = headlineHoldSeconds(words);

    if (hold >= needed) return [];

    return [
      warn(
        event.path,
        'headline_hold_short',
        `${event.element}: a ${words}-word headline holds ${s(Math.max(0, hold))} after landing (needs ${s(needed)})`,
        `Hold a headline 0.4 s + words / 3.5 s after it lands: delay the exit or the cut, or shorten the copy.`
      ),
    ];
  });
}

function purposeRequired(meta: Loose | undefined): boolean {
  if (meta?.requirePurpose === false) return false;

  return meta?.requirePurpose === true || (typeof meta?.brief === 'string' && meta.brief.trim() !== '');
}

/** section_without_purpose, gated on meta.brief / meta.requirePurpose so existing templates stay quiet. */
export function purposeWarnings(template: { meta?: unknown; sections?: unknown }): RoleWarning[] {
  if (!purposeRequired(template.meta as Loose | undefined) || !Array.isArray(template.sections)) return [];

  return (template.sections as Loose[]).flatMap((section, index) => {
    const purpose = section.purpose;

    if (!RENDERING_SECTION_TYPES.has(String(section.type)) || (typeof purpose === 'string' && purpose.trim())) {
      return [];
    }

    return [
      warn(
        `sections[${index}]`,
        'section_without_purpose',
        `Section "${typeof section.name === 'string' ? section.name : index}" has no purpose`,
        'State in one sentence why this beat exists (purpose) and its role (hook, proof, cta…); cut it if you cannot.'
      ),
    ];
  });
}

/** Role findings for every section of the timeline, plus the purpose advisory. Never throws. */
export function roleWarnings(data: unknown, timeline: MotionTimeline): RoleWarning[] {
  const template = (data ?? {}) as { meta?: unknown; sections?: unknown };
  const sections = Array.isArray(template.sections) ? (template.sections as Loose[]) : [];

  return [
    ...timeline.sections.flatMap((section) => [
      ...overshootOveruse(section),
      ...headlineHoldShort(section, sections[section.index]),
    ]),
    ...purposeWarnings(template),
  ];
}
