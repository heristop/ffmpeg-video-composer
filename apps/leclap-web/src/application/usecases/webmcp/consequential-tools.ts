// Consequential actions (#19–#23): replacing the whole draft, opening a sample in its place, the WASM
// preview render, grabbing frames from that preview, and saving to the library. Each runs only after the
// user allowed it in the page (render_frames rides on its preview's consent) and is refused up front —
// before anyone is asked — when it would fail anyway. A replaced draft is one history step, so Undo
// brings the previous one back. Filming with real footage is never exposed: the agent asks the user to
// click Save & film.
import { z } from 'zod';
import { videoTimeline } from 'ffmpeg-video-composer/src/core/timing/video-timeline.ts';
import { invalidTemplateText } from 'ffmpeg-video-composer/src/services/validation-format.ts';
import { buildDescriptor, type EditorState, type TemplateDescriptor } from '@leclap/creative-kit/editor';
import { materializeTemplatePartials } from '@/services/templatePartialService';
import { runValidation } from '@/presentation/components/admin/editor/validationMapping';
import {
  generatedToEditorState,
  sampleToEditorState,
} from '@/presentation/components/admin/ai-generate/load-generated';
import { builderRefusal, droppedPointers } from './apply-descriptor';
import { revisionOf } from './descriptor-view';
import { note } from './edit-tools';
import { sanitizeDeep, sanitizeText, unsafeNewUrls } from './guard';
import { saveBlockerText as blockerText } from '@/presentation/components/admin/editor-shell/save-blocker.logic';
import { fail, ok } from './results';
import { RENDER_FRAMES } from './frames-tool';
import { loadSample, sampleCheck } from './sample-loader';
import { defineTool, type BuilderPort, type ToolContext, type ToolResult } from './types';

/** Least time between two agent preview renders. */
export const RENDER_COOLDOWN_MS = 30_000;

function positions(state: EditorState): number[] {
  return state.sections.map((_section, position) => position);
}

function droppedWarning(dropped: string[]) {
  return dropped.length > 0
    ? { dropped, warnings: [{ code: 'builder_dropped_field', message: 'The builder does not keep these fields.' }] }
    : {};
}

/** Installs `next` as one undoable step and describes it. */
export function replaceWith(next: EditorState, source: unknown, ctx: ToolContext, summary: string): ToolResult {
  const built = buildDescriptor(next);
  ctx.replace(next, positions(next));

  return ok(
    {
      revision: revisionOf(built),
      name: next.name,
      sectionCount: next.sections.length,
      ...droppedWarning(droppedPointers(source, built)),
    },
    summary
  );
}

function candidateOf(template: Record<string, unknown>): TemplateDescriptor {
  return sanitizeDeep(template) as TemplateDescriptor;
}

const replaceTemplate = defineTool({
  name: 'replace_template',
  title: 'Replace Template',
  description:
    'Replace the whole draft with `template` (a complete descriptor) after the user allows it in the page. It must ' +
    'validate on its own and fit the builder (no effect sections, known partials, no new media). It opens as a ' +
    'new draft; Undo brings the previous one back. Prefer edit_template for changes to the current draft.',
  kind: 'consequential',
  requires: 'replace',
  input: z.object({
    template: z.record(z.string(), z.unknown()).describe('The complete template descriptor.'),
    name: z.string().min(1).max(200).optional().describe('Draft name (default: meta.name, else "Untitled").'),
    note,
  }),
  check: (args, ctx) => {
    const candidate = candidateOf(args.template);
    const refused = builderRefusal(candidate, ctx);

    if (refused) return refused;

    const urls = unsafeNewUrls(buildDescriptor(ctx.port.getState()), candidate, ctx.origin);

    if (urls.length > 0) return fail('invalid_input', `Refused URL(s): ${urls.join('; ')}`);

    const errors = runValidation(candidate, ctx.port.localPartials());

    return errors.length > 0
      ? fail('invalid_template', invalidTemplateText({ message: 'Invalid template', errors }), { errors })
      : null;
  },
  confirmDetail: (args) => ({
    name: sanitizeText(args.name ?? '') || 'Untitled',
    sections: Array.isArray(args.template.sections) ? args.template.sections.length : 0,
  }),
  run: (args, ctx) => {
    const candidate = candidateOf(args.template);
    const next = generatedToEditorState(candidate, sanitizeText(args.name ?? '') || 'Untitled');

    if (args.name) next.name = sanitizeText(args.name);

    return replaceWith(next, candidate, ctx, `Replaced the draft with "${next.name}".`);
  },
});

const loadSampleTool = defineTool({
  name: 'load_sample',
  title: 'Load Sample',
  description:
    'Open a packaged sample (an `openable` id from list_samples) as a new draft in place of the current one, ' +
    'optionally with a built-in `theme`, after the user allows it in the page. Undo brings the previous draft back.',
  kind: 'consequential',
  requires: 'replace',
  input: z.object({
    id: z.string().min(1).max(200).describe('Sample id from list_samples (openable: true).'),
    theme: z.string().min(1).max(60).optional().describe('A built-in theme name to apply.'),
    note,
  }),
  check: (args) => sampleCheck(args.id),
  confirmDetail: async (args) => ({ title: (await loadSample(args.id))?.title ?? args.id }),
  run: async (args, ctx) => {
    const sample = await loadSample(args.id);

    if (!sample) return fail('not_found', `No sample ${args.id}.`, { hint: 'Use list_samples.' });

    const next = sampleToEditorState(sample, args.theme ? sanitizeText(args.theme) : undefined);

    return replaceWith(next, sample.template, ctx, `Opened sample "${sample.title}".`);
  },
});

/** The draft's video length in seconds, render-free (0 when it cannot be worked out). */
export function videoSeconds(port: BuilderPort): number {
  try {
    const descriptor = materializeTemplatePartials(buildDescriptor(port.getState()), port.localPartials());

    return Math.round(videoTimeline(descriptor).duration * 10) / 10;
  } catch {
    return 0;
  }
}

/** A rough wall-clock estimate of the in-browser render (ultrafast preset, placeholder media). */
export function estimatedRenderSeconds(duration: number): number {
  return Math.max(10, Math.round(duration * 3));
}

function renderable(port: BuilderPort): ToolResult | null {
  const state = port.getState();

  if (state.sections.length === 0) return fail('invalid_input', 'The draft has no scenes to render.');

  const errors = runValidation(buildDescriptor(state), port.localPartials());

  return errors.length > 0
    ? fail('invalid_template', invalidTemplateText({ message: 'Fix these before a preview', errors }), { errors })
    : null;
}

const renderPreview = defineTool({
  name: 'render_preview',
  title: 'Render Preview',
  description:
    'Render the current draft in the browser (WASM, placeholder media for clips and form fields) after the user ' +
    'allows it; the video opens in the page’s preview dialog. One at a time, at most every 30 s. Returns how long ' +
    'it took; then call render_frames to look at it. Real footage is filmed by the user (Save & film).',
  kind: 'consequential',
  requires: 'preview-render',
  sessionAllowable: true,
  cooldownMs: RENDER_COOLDOWN_MS,
  input: z.object({ note }),
  check: (_args, { port }) => (port.previewRender ? renderable(port) : fail('unavailable', 'No preview here.')),
  confirmDetail: (_args, port) => {
    const duration = videoSeconds(port);

    return { duration, seconds: estimatedRenderSeconds(duration) };
  },
  run: async (_args, { port, signal }) => {
    const outcome = await port.previewRender?.(signal);
    const durationSeconds = videoSeconds(port);

    if (!outcome || outcome.status === 'busy') return fail('busy', 'A preview render is already running.');

    if (signal.aborted) return fail('aborted', 'The render was cancelled.');

    if (outcome.status === 'failed') {
      return fail('render_failed', outcome.failure, { seconds: outcome.seconds, durationSeconds });
    }

    return ok(
      { status: 'done', seconds: outcome.seconds, durationSeconds },
      `Preview rendered in ${String(outcome.seconds)} s; the user sees it in the preview dialog.`
    );
  },
});

const saveTemplate = defineTool({
  name: 'save_template',
  title: 'Save Template',
  description:
    "Save the draft to the user's template library on this device after they allow it; the builder stays open. " +
    'Refused with save_blocked (and the reason) when the draft cannot be saved yet, e.g. it has no name. To film ' +
    'it with real footage, ask the user to click Save & film.',
  kind: 'consequential',
  requires: 'save',
  input: z.object({ note }),
  check: (_args, { port }) => {
    const blocker = blockerText(port.getState());

    return blocker ? fail('save_blocked', `The draft cannot be saved yet: ${blocker}.`, { blocker }) : null;
  },
  confirmDetail: (_args, port) => ({ name: port.getState().name.trim() }),
  run: (_args, { port }) => {
    const outcome = port.save?.();

    if (!outcome) return fail('unavailable', 'Saving is not available here.');

    if (!outcome.saved) return fail('save_blocked', `Not saved: ${outcome.blocker}.`, { blocker: outcome.blocker });

    return ok({ saved: true, id: outcome.id }, 'Saved to the template library.');
  },
});

export const CONSEQUENTIAL_TOOLS = [replaceTemplate, loadSampleTool, renderPreview, RENDER_FRAMES, saveTemplate];
