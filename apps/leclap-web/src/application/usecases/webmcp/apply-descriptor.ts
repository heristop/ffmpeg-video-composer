// The single path every descriptor-level agent edit takes: candidate descriptor → builder checks →
// engine validation (no NEW errors) → URL policy → re-hydrate into editor state → round trip → diff of
// what the builder dropped → one history commit. The builder's model does not carry everything a
// descriptor can say, so the round trip is reported, never silent: fields the builder dropped come back
// as `dropped` pointers with a builder_dropped_field warning, and an edit the builder dropped entirely is
// refused as no_effect with nothing committed. Sections the edit did not touch keep their editor objects
// (and editor-only fields such as upload labels), so only the changed scene cards re-render and glow.
import { invalidTemplateText } from 'ffmpeg-video-composer/src/services/validation-format.ts';
import type { ValidationError } from 'ffmpeg-video-composer/src/services/validation/types.ts';
import { OrientationSchema } from 'ffmpeg-video-composer/src/schemas/global.schemas.ts';
import { buildDescriptor, toEditorState, type EditorState, type TemplateDescriptor } from '@leclap/creative-kit/editor';
import { listAvailablePartials } from '@/services/templatePartialService';
import { runValidation } from '@/presentation/components/admin/editor/validationMapping';
import { unsafeNewUrls } from './guard';
import { escapePointerSegment, revisionOf } from './descriptor-view';
import { fail, ok } from './results';
import type { ToolContext, ToolResult } from './types';

const MAX_DROPPED = 50;
const SECTION_NAME = /^\/sections\/\d+\/name$/;

/** JSON with object keys sorted, so equal values compare equal whatever their key order. */
export function stableKey(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (!inner || typeof inner !== 'object' || Array.isArray(inner)) return inner;

    return Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : Number(a > b))));
  });
}

/** Editor state for `descriptor`, keeping the draft's id and identity fallbacks. */
export function rehydrate(descriptor: TemplateDescriptor, prev: EditorState): EditorState {
  const orientation = OrientationSchema.safeParse(descriptor.global?.orientation);

  return toEditorState({
    id: prev.id,
    name: prev.name,
    description: prev.description,
    orientation: orientation.success ? orientation.data : prev.orientation,
    descriptor,
  });
}

type Sections = EditorState['sections'];

function musicCount(sections: Sections): number {
  return sections.filter((section) => section.kind === 'music').length;
}

// Pairs each section of the draft's own round trip with the draft section it came from. The round trip
// moves music first (it lives in global fields) and keeps the rest in order, so each pairs with the next
// unclaimed draft section of its group. Music the round trip cannot express (nothing to pick, no upload)
// stays unclaimed.
function pairDraft(prev: EditorState, normalized: EditorState) {
  const pool = new Map<string, Sections>();
  const music = prev.sections.filter((section) => section.kind === 'music');
  const others = prev.sections.filter((section) => section.kind !== 'music');

  for (const section of normalized.sections) {
    const original = (section.kind === 'music' ? music : others).shift() ?? section;
    const key = stableKey(section);
    pool.set(key, [...(pool.get(key) ?? []), original]);
  }

  return { pool, lostMusic: music };
}

// Puts back the music sections the descriptor could not carry, when the edit did not touch music.
function restoreLostMusic(sections: Sections, changed: number[], prev: EditorState, lost: Sections): void {
  for (const section of lost) {
    const at = Math.min(prev.sections.indexOf(section), sections.length);
    sections.splice(at, 0, section);

    for (const [i, position] of changed.entries()) if (position >= at) changed[i] = position + 1;
  }
}

/**
 * `next` with every section (and top-level field) the edit did not change swapped back to the draft's
 * own object, plus the positions that did change.
 */
export function reuseUnchanged(prev: EditorState, next: EditorState): { state: EditorState; changed: number[] } {
  const normalized = rehydrate(buildDescriptor(prev), prev);
  const { pool, lostMusic } = pairDraft(prev, normalized);
  const changed: number[] = [];
  const sections = next.sections.map((section, position) => {
    const reused = pool.get(stableKey(section))?.shift();

    if (!reused) changed.push(position);

    return reused ?? section;
  });

  if (musicCount(next.sections) === musicCount(normalized.sections)) {
    restoreLostMusic(sections, changed, prev, lostMusic);
  }

  const merged: Record<string, unknown> = { ...next, sections };
  const prevRecord = prev as unknown as Record<string, unknown>;
  const normalRecord = normalized as unknown as Record<string, unknown>;

  for (const key of new Set([...Object.keys(prevRecord), ...Object.keys(merged)])) {
    if (key === 'sections' || key === 'id') continue;

    if (stableKey(merged[key]) === stableKey(normalRecord[key])) merged[key] = prevRecord[key];
  }

  return { state: merged as unknown as EditorState, changed };
}

function valueAt(doc: unknown, segments: string[]): unknown {
  let current = doc;

  for (const segment of segments) {
    if (!current || typeof current !== 'object') return undefined;

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function leafDiffs(candidate: unknown, built: unknown, segments: string[], out: string[]): void {
  if (out.length >= MAX_DROPPED) return;

  if (candidate && typeof candidate === 'object') {
    for (const [key, child] of Object.entries(candidate)) leafDiffs(child, built, [...segments, key], out);

    return;
  }

  const pointer = `/${segments.map(escapePointerSegment).join('/')}`;

  if (SECTION_NAME.test(pointer)) return;

  if (stableKey(valueAt(built, segments)) !== stableKey(candidate)) out.push(pointer);
}

/** Pointers whose value in `candidate` did not survive into `built` (section names are the builder's). */
export function droppedPointers(candidate: unknown, built: unknown): string[] {
  const out: string[] = [];
  leafDiffs(candidate, built, [], out);

  return out;
}

type LooseSections = Array<{ type?: unknown; ref?: unknown }>;

/** Refusals the engine validator does not make: effect sections, and partial refs the builder lacks. */
export function builderRefusal(candidate: TemplateDescriptor, ctx: ToolContext): ToolResult | null {
  const sections = (candidate.sections ?? []) as LooseSections;
  const effect = sections.findIndex((section) => section.type === 'effect');

  if (effect !== -1) {
    return fail('builder_unsupported_section', `sections[${String(effect)}] is an effect section.`, {
      hint: 'The builder cannot hold registered-effect sections; rebuild it as a color_background with a titleCard or kinetic text.',
    });
  }

  const known = new Set(listAvailablePartials(ctx.port.localPartials()).map((partial) => partial.id));
  const unknown = sections.findIndex(
    (section) => section.type === 'partial' && typeof section.ref === 'string' && !known.has(section.ref)
  );

  if (unknown === -1) return null;

  return fail('invalid_template', `sections[${String(unknown)}].ref is not a partial this builder has.`, {
    hint: `Use one of: ${[...known].slice(0, 30).join(', ')}.`,
  });
}

function errorKey(error: ValidationError): string {
  return `${error.path}|${error.code}`;
}

/** Validation errors `candidate` has that `base` did not (errors already there never block an edit). */
export function newErrors(
  base: TemplateDescriptor,
  candidate: TemplateDescriptor,
  ctx: ToolContext
): ValidationError[] {
  const partials = ctx.port.localPartials();
  const existing = new Set(runValidation(base, partials).map(errorKey));

  return runValidation(candidate, partials).filter((error) => !existing.has(errorKey(error)));
}

function invalid(errors: ValidationError[]): ToolResult {
  return fail('invalid_template', invalidTemplateText({ message: 'Invalid template', errors }), { errors });
}

function changedNames(descriptor: TemplateDescriptor, state: EditorState, changed: number[]): string[] {
  const names = (descriptor.sections ?? []).map((section) => section.name ?? '');
  let descriptorIndex = 0;
  const byPosition = state.sections.map((section) => (section.kind === 'music' ? 'music' : names[descriptorIndex++]));

  return changed.map((position) => byPosition[position] ?? String(position));
}

// The candidate's refusals, in the order an agent should fix them; null when it may be applied.
function refusalOf(base: TemplateDescriptor, candidate: TemplateDescriptor, ctx: ToolContext): ToolResult | null {
  const builder = builderRefusal(candidate, ctx);

  if (builder) return builder;

  const urls = unsafeNewUrls(base, candidate, ctx.origin);

  if (urls.length > 0) return fail('invalid_input', `Refused URL(s): ${urls.join('; ')}`);

  const errors = newErrors(base, candidate, ctx);

  return errors.length > 0 ? invalid(errors) : null;
}

function summaryLine(changed: number[], dropped: string[]): string {
  const scope = changed.length > 0 ? `${String(changed.length)} section(s) changed` : 'template-wide settings changed';
  const loss = dropped.length > 0 ? `, ${String(dropped.length)} field(s) dropped by the builder` : '';

  return `Applied: ${scope}${loss}.`;
}

/** Applies `candidate` as one undo step (or refuses it with nothing committed); `prev` is the state it was computed from. */
export function applyDescriptor(candidate: unknown, prev: EditorState, ctx: ToolContext): ToolResult {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return fail('invalid_input', 'The template must be a JSON object.');
  }

  const base = buildDescriptor(prev);
  const descriptor = candidate as TemplateDescriptor;
  const refused = refusalOf(base, descriptor, ctx);

  if (refused) return refused;

  const { state: next, changed } = reuseUnchanged(prev, rehydrate(descriptor, prev));
  const built = buildDescriptor(next);
  const baseLoss = new Set(droppedPointers(base, buildDescriptor(rehydrate(base, prev))));
  const dropped = droppedPointers(descriptor, built).filter((pointer) => !baseLoss.has(pointer));

  if (stableKey(built) === stableKey(base)) {
    return fail('no_effect', 'The builder kept nothing of this edit; the template is unchanged.', {
      dropped,
      hint: 'These fields have no place in the builder model. Use fields list_sections and get_template show.',
    });
  }

  ctx.commit(next, changed);
  const warnings =
    dropped.length > 0
      ? [{ code: 'builder_dropped_field', message: 'The builder does not keep these fields; they were dropped.' }]
      : undefined;

  return ok(
    {
      revision: revisionOf(built),
      changedSections: changedNames(built, next, changed),
      changedPositions: changed,
      ...(dropped.length > 0 ? { dropped, warnings } : {}),
    },
    summaryLine(changed, dropped)
  );
}
