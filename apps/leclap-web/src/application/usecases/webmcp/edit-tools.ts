// Undoable edits (#10–#15). Each one checks `expectedRevision` against the draft, is all-or-nothing, may
// not introduce validation errors, and lands as exactly one history step — so the user's Ctrl/Cmd+Z and
// the titlebar Undo revert an agent edit like their own. `undo` reverts only the agent's own newest step,
// and only while the user has not edited since.
import { z } from 'zod';
import { applyJsonPatch, JsonPatchError } from 'ffmpeg-video-composer/src/core/json-patch.ts';
import { invalidTemplateText } from 'ffmpeg-video-composer/src/services/validation-format.ts';
import {
  addSection,
  buildDescriptor,
  removeSection,
  reorderSection,
  setTransitionAfter,
  type EditorSection,
  type EditorState,
  type TemplateDescriptor,
} from '@leclap/creative-kit/editor';
import { descriptorIndexForEditor } from '@/presentation/components/admin/editor/validationMapping';
import { applyDescriptor, newErrors } from './apply-descriptor';
import { nameAt, revisionOf, textSlots } from './descriptor-view';
import { MAX_SCREEN_TEXT, sanitizeDeep, sanitizeText } from './guard';
import { resolvePosition, sectionRef } from './read-tools';
import { fail, ok, revisionConflict } from './results';
import { defineTool, type ToolContext, type ToolResult } from './types';

export const expectedRevision = z
  .string()
  .min(1)
  .max(128)
  .describe('The revision from get_template / list_sections; a stale one fails with revision_conflict.');
export const note = z
  .string()
  .max(200)
  .optional()
  .describe('One line telling the user why (shown in the activity log).');

const SECTION_TYPES = {
  project_video: 'video',
  color_background: 'color',
  image_background: 'image',
  form: 'form',
  music: 'music',
  partial: 'partial',
} as const satisfies Record<string, EditorSection['kind']>;

type SectionType = keyof typeof SECTION_TYPES;

export function stale(state: EditorState, expected: string): boolean {
  return revisionOf(buildDescriptor(state)) !== expected;
}

function patched(base: TemplateDescriptor, operations: unknown[]): TemplateDescriptor | ToolResult {
  try {
    return applyJsonPatch(base, operations, { maxOps: 100 });
  } catch (error) {
    if (!(error instanceof JsonPatchError)) throw error;

    return fail('invalid_input', error.message, { patchCode: error.code, operation: error.index });
  }
}

const VISUAL_KINDS = new Set<EditorSection['kind']>(['video', 'color', 'image']);

// Removing or moving sections can leave a transition after the last visual section, which the builder
// never shows a control for and the validator rejects; the builder's own lane clears it the same way.
function withoutDanglingTransition(state: EditorState): EditorState {
  const last = state.sections.findLastIndex((section) => VISUAL_KINDS.has(section.kind));
  const section = state.sections.at(last);

  if (!section || !('transitionAfter' in section) || section.transitionAfter === undefined) return state;

  return setTransitionAfter(state, last, undefined);
}

// Commits an editor-op result after checking it introduces no validation error.
function commitOp(prev: EditorState, next: EditorState, changed: number[], ctx: ToolContext, name: string): ToolResult {
  const before = buildDescriptor(prev);
  const after = buildDescriptor(next);
  const errors = newErrors(before, after, ctx);

  if (errors.length > 0) {
    return fail('invalid_template', invalidTemplateText({ message: 'Invalid template', errors }), { errors });
  }

  ctx.commit(next, changed);

  return ok({ revision: revisionOf(after), changedSections: [name], changedPositions: changed }, `Applied to ${name}.`);
}

const editTemplate = defineTool({
  name: 'edit_template',
  title: 'Edit Template',
  description:
    'Apply a JSON Patch (RFC 6902: add, remove, replace, move, copy, test; RFC 6901 pointers) to the current ' +
    'template descriptor, atomically and as one undo step. Paths start at the descriptor root, e.g. ' +
    '"/sections/1/options/duration" (list_sections gives each section\'s pointer). Fails with revision_conflict ' +
    'when expectedRevision is stale, invalid_template when the result would add validation errors, and ' +
    'no_effect when the builder keeps none of it; fields the builder drops are listed in `dropped`.',
  kind: 'edit',
  input: z.object({
    expectedRevision,
    operations: z
      .array(
        z.object({
          op: z.enum(['add', 'remove', 'replace', 'move', 'copy', 'test']),
          path: z.string().max(1000),
          value: z.unknown().optional(),
          from: z.string().max(1000).optional(),
        })
      )
      .min(1)
      .max(100),
    note,
  }),
  run: (args, ctx) => {
    const state = ctx.port.getState();

    if (stale(state, args.expectedRevision)) return revisionConflict();

    const operations = args.operations.map((operation) => sanitizeDeep(operation));
    const candidate = patched(buildDescriptor(state), operations);

    return 'content' in candidate ? candidate : applyDescriptor(candidate, state, ctx);
  },
});

// The new default section merged with the agent's fragment (its type is fixed, its name the builder's).
function withFragment(
  generated: Record<string, unknown>,
  fragment: Record<string, unknown>
): Record<string, unknown> | null {
  if (fragment.type !== undefined && fragment.type !== generated.type) return null;

  const options = { ...(generated.options as object | undefined), ...(fragment.options as object | undefined) };

  return { ...generated, ...fragment, type: generated.type, name: generated.name, options };
}

function insertSection(
  state: EditorState,
  type: SectionType,
  position: number | undefined
): { next: EditorState; at: number } {
  const appended = addSection(state, SECTION_TYPES[type]);
  const last = appended.sections.length - 1;
  const at = position === undefined ? last : Math.min(position, last);

  return { next: at === last ? appended : reorderSection(appended, last, at), at };
}

const addSectionTool = defineTool({
  name: 'add_section',
  title: 'Add Section',
  description:
    'Insert a new section of `type` at editor `position` (default: the end), with the builder defaults, optionally ' +
    'merged with a descriptor `section` fragment (e.g. {"options":{"duration":4,"backgroundColor":"#101820"},' +
    '"titleCard":{"headline":{"en":"Hello"}}}). A partial needs section.ref from get_template.availablePartials. ' +
    'One undo step.',
  kind: 'edit',
  input: z.object({
    expectedRevision,
    type: z.enum(Object.keys(SECTION_TYPES) as [SectionType, ...SectionType[]]),
    position: z.number().int().min(0).max(500).optional(),
    section: z.record(z.string(), z.unknown()).optional().describe('Descriptor fields for the new section.'),
    note,
  }),
  run: (args, ctx) => {
    const state = ctx.port.getState();

    if (stale(state, args.expectedRevision)) return revisionConflict();

    if (args.type === 'partial' && typeof args.section?.ref !== 'string') {
      return fail('invalid_input', 'A partial section needs section.ref.', {
        hint: 'Pick an id from get_template.availablePartials.',
      });
    }

    const { next, at } = insertSection(state, args.type, args.position);
    const index = descriptorIndexForEditor(next)[at];

    // Builder defaults alone: the editor op itself (an empty music section has no descriptor form).
    if (!args.section) return commitOp(state, next, [at], ctx, nameAt(next, at));

    if (index === null) {
      return fail('invalid_input', 'Music takes no section fragment; set global.allowedMusic with edit_template.');
    }

    const candidate = buildDescriptor(next);
    const sections = (candidate.sections ?? []) as unknown as Array<Record<string, unknown>>;
    const merged = withFragment(sections[index], sanitizeDeep(args.section) as Record<string, unknown>);

    if (!merged) return fail('invalid_input', `section.type must be ${args.type}.`);

    sections[index] = merged;

    return applyDescriptor(candidate, state, ctx);
  },
});

const removeSectionTool = defineTool({
  name: 'remove_section',
  title: 'Remove Section',
  description:
    'Remove one section (by name or editor position). The last remaining section cannot be removed. One undo step.',
  kind: 'edit',
  input: z.object({ expectedRevision, ...sectionRef, note }),
  run: (args, ctx) => {
    const state = ctx.port.getState();

    if (stale(state, args.expectedRevision)) return revisionConflict();

    const position = resolvePosition(state, args);

    if (typeof position !== 'number') return position;

    if (state.sections.length <= 1) return fail('invalid_input', 'The template must keep at least one section.');

    return commitOp(state, withoutDanglingTransition(removeSection(state, position)), [], ctx, nameAt(state, position));
  },
});

const moveSection = defineTool({
  name: 'move_section',
  title: 'Move Section',
  description: 'Move the section at editor position `from` to position `to`. One undo step.',
  kind: 'edit',
  input: z.object({
    expectedRevision,
    from: z.number().int().min(0).max(500),
    to: z.number().int().min(0).max(500),
    note,
  }),
  run: (args, ctx) => {
    const state = ctx.port.getState();

    if (stale(state, args.expectedRevision)) return revisionConflict();

    const count = state.sections.length;

    if (args.from >= count || args.to >= count) {
      return fail('not_found', `Positions run from 0 to ${String(count - 1)}.`, { hint: 'Call list_sections.' });
    }

    if (args.from === args.to) return fail('no_effect', 'from and to are the same position.');

    return commitOp(
      state,
      withoutDanglingTransition(reorderSection(state, args.from, args.to)),
      [args.to],
      ctx,
      nameAt(state, args.from)
    );
  },
});

const setTexts = defineTool({
  name: 'set_texts',
  title: 'Set Texts',
  description:
    'Replace on-screen copy in one step: each edit names a text `pointer` exactly as list_sections reports it ' +
    `(e.g. "/sections/0/titleCard/headline/en") and the new text (≤${String(MAX_SCREEN_TEXT)} characters). ` +
    'One undo step for the whole batch.',
  kind: 'edit',
  input: z.object({
    expectedRevision,
    edits: z
      .array(z.object({ pointer: z.string().max(500), text: z.string().max(MAX_SCREEN_TEXT) }))
      .min(1)
      .max(50),
    note,
  }),
  run: (args, ctx) => {
    const state = ctx.port.getState();

    if (stale(state, args.expectedRevision)) return revisionConflict();

    const base = buildDescriptor(state);
    const known = new Set(textSlots(base, '').map((slot) => slot.pointer));
    const unknown = args.edits.find((edit) => !known.has(edit.pointer));

    if (unknown) {
      return fail('not_found', `${unknown.pointer} is not a text in this template.`, {
        hint: 'Use the pointers list_sections reports.',
      });
    }

    const operations = args.edits.map((edit) => ({
      op: 'replace',
      path: edit.pointer,
      value: sanitizeText(edit.text),
    }));
    const candidate = patched(base, operations);

    return 'content' in candidate ? candidate : applyDescriptor(candidate, state, ctx);
  },
});

const undoTool = defineTool({
  name: 'undo',
  title: 'Undo Agent Step',
  description:
    'Revert your own most recent edit, if it is still the current state. When the user has edited since, it fails ' +
    'with not_found: ask them to undo instead.',
  kind: 'edit',
  confirm: 'never',
  input: z.object({}),
  run: (_args, ctx) => {
    if (!ctx.undoAgentStep()) {
      return fail('not_found', 'No agent step to undo: the user has edited since, or there is none.', {
        hint: 'Ask the user to undo in the builder.',
      });
    }

    return ok({ revision: revisionOf(buildDescriptor(ctx.port.getState())) }, 'Reverted the last agent step.');
  },
});

export const EDIT_TOOLS = [editTemplate, addSectionTool, removeSectionTool, moveSection, setTexts, undoTool];
