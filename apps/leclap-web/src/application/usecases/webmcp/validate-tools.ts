// Checking without changing anything: #7 validate_template (the current draft, or a candidate the agent
// is about to apply) in the same shape and wording as @leclap/mcp's validate_template, plus a builder
// advisory listing the fields the builder would drop; #8 get_timeline, the render-free whole-video
// timeline. Neither renders: geometry advisories (text overflow, collisions, safe zones, contrast) are
// measured render-free with the bundled fonts the page serves; a pixel check is render_preview.
import { z } from 'zod';
import { invalidTemplateText } from 'ffmpeg-video-composer/src/services/validation-format.ts';
import { TemplateValidator } from 'ffmpeg-video-composer/src/services/TemplateValidator.ts';
import type { ValidationError } from 'ffmpeg-video-composer/src/services/validation/types.ts';
import { effectiveOrientation } from 'ffmpeg-video-composer/src/core/platforms.ts';
import { videoTimeline } from 'ffmpeg-video-composer/src/core/timing/video-timeline.ts';
import { resolveFormat } from 'ffmpeg-video-composer/src/core/formats/resolve.ts';
import { buildDescriptor, type TemplateDescriptor } from '@leclap/creative-kit/editor';
import { materializeTemplatePartials } from '@/services/templatePartialService';
import { runValidation } from '@/presentation/components/admin/editor/validationMapping';
import { droppedPointers, rehydrate } from './apply-descriptor';
import { revisionOf } from './descriptor-view';
import { capOutput, fail, ok } from './results';
import { defineTool, type BuilderPort, type ToolResult } from './types';

const validator = new TemplateValidator();
const templateArg = z
  .record(z.string(), z.unknown())
  .optional()
  .describe('A candidate descriptor; omit to use the builder’s current template.');

function effectErrors(descriptor: TemplateDescriptor): ValidationError[] {
  return (descriptor.sections ?? []).flatMap((section, index) =>
    section.type === 'effect'
      ? [
          {
            path: `sections[${String(index)}].type`,
            code: 'builder_unsupported_section',
            message: 'The builder cannot hold registered-effect sections.',
            hint: 'Rebuild it as a color_background with a titleCard or kinetic text.',
          },
        ]
      : []
  );
}

function requiredClips(descriptor: TemplateDescriptor): string[] {
  return (descriptor.sections ?? [])
    .filter((section) => section.type === 'project_video' && typeof section.name === 'string')
    .map((section) => section.name as string);
}

function formFields(descriptor: TemplateDescriptor): string[] {
  return (descriptor.sections ?? [])
    .filter((section) => section.type === 'form')
    .flatMap((section) => section.options?.fields ?? [])
    .map((field) => field.name);
}

function motionWarnings(descriptor: TemplateDescriptor, port: BuilderPort) {
  try {
    const warnings = validator.getMotionWarnings(materializeTemplatePartials(descriptor, port.localPartials()));

    return warnings.length > 0 ? warnings : null;
  } catch {
    return null;
  }
}

// Render-free geometry advisories, measured with the page's bundled fonts (approximate without them).
async function geometryWarnings(descriptor: TemplateDescriptor, port: BuilderPort) {
  try {
    const expanded = materializeTemplatePartials(descriptor, port.localPartials());
    const warnings = await validator.getGeometryWarnings(
      expanded as Parameters<typeof validator.getGeometryWarnings>[0],
      port.loadFont
    );

    return warnings.length > 0 ? warnings : null;
  } catch {
    return null;
  }
}

// Fields a candidate carries that the builder would not keep.
function builderAdvisories(descriptor: TemplateDescriptor, port: BuilderPort) {
  const dropped = droppedPointers(descriptor, buildDescriptor(rehydrate(descriptor, port.getState())));

  return dropped.length > 0
    ? [{ code: 'builder_dropped_field', message: 'The builder would drop these fields on apply.', pointers: dropped }]
    : undefined;
}

function invalidResult(descriptor: TemplateDescriptor, errors: ValidationError[]): ToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: invalidTemplateText({ message: 'Invalid template', errors }) }],
    structuredContent: { valid: false, revision: revisionOf(descriptor), errors },
  };
}

function validSummary(descriptor: TemplateDescriptor, clips: string[], fields: string[], orientation: string | null) {
  const needs = [
    clips.length > 0 ? `clips: ${clips.join(', ')}` : 'no clips',
    fields.length > 0 ? `fields: ${fields.join(', ')}` : 'no fields',
  ].join('; ');

  return `Valid template — ${String(descriptor.sections?.length ?? 0)} section(s), ${orientation ?? 'default'} orientation. Requires ${needs}.`;
}

const validateTemplate = defineTool({
  name: 'validate_template',
  title: 'Validate Template',
  description:
    'Dry-run the current template (or a candidate `template`) against the engine schema and the builder’s limits, ' +
    'render-free. Returns valid plus what filming needs (requiredClips, formFields), motionWarnings (pacing advice, and ' +
    'sameness: fx_untuned, effect_repeated, library_animation_sample, effect_off_theme, decor_overload), ' +
    'geometry (render-free text fit, collisions, safe zones, contrast) and, for a candidate, builder advisories ' +
    'naming fields the builder would drop. Invalid: isError with every ' +
    'finding in errors[] (path, code, message, hint, suggestion). `render: true` is not available here.',
  kind: 'read',
  input: z.object({
    template: templateArg,
    render: z.boolean().optional().describe('Not supported in the builder; the user runs Preview render.'),
  }),
  run: async (args, { port }) => {
    const candidate = args.template !== undefined;
    const descriptor = (args.template ?? buildDescriptor(port.getState())) as TemplateDescriptor;
    const errors = [...effectErrors(descriptor), ...runValidation(descriptor, port.localPartials())];

    if (errors.length > 0) return invalidResult(descriptor, errors);

    const clips = requiredClips(descriptor);
    const fields = formFields(descriptor);
    const orientation = effectiveOrientation(descriptor.global) ?? null;
    const motion = motionWarnings(descriptor, port);
    const geometry = await geometryWarnings(descriptor, port);
    const advisories = candidate ? builderAdvisories(descriptor, port) : undefined;
    const render = args.render
      ? { measured: 0, seconds: 0, unavailable: 'not in the builder: ask the user to run Preview render' }
      : undefined;
    const structured = {
      valid: true,
      revision: revisionOf(descriptor),
      sectionCount: descriptor.sections?.length ?? 0,
      orientation,
      requiredClips: clips,
      formFields: fields,
      ...(motion ? { motionWarnings: motion } : {}),
      ...(geometry ? { geometry } : {}),
      ...(advisories ? { advisories } : {}),
      ...(render ? { render } : {}),
    };

    return capOutput(
      ok(structured, validSummary(descriptor, clips, fields, orientation)),
      'Validate a smaller template.'
    );
  },
});

const getTimeline = defineTool({
  name: 'get_timeline',
  title: 'Get Timeline',
  description:
    'Return the template timeline on whole-video seconds, render-free: sections with absolute start/end ' +
    '(transitions overlap the clips they join), every motion event with its window and ease, the beat grid and ' +
    'cues. `approx` is true when a clip length is assumed. Uses the current template unless `template` is given.',
  kind: 'read',
  input: z.object({
    template: templateArg,
    format: z.enum(['landscape', 'portrait', 'square']).optional().describe('Resolve this output format first.'),
  }),
  run: (args, { port }) => {
    const descriptor = (args.template ?? buildDescriptor(port.getState())) as TemplateDescriptor;
    const errors = runValidation(descriptor, port.localPartials());

    if (errors.length > 0) return invalidResult(descriptor, errors);

    try {
      const expanded = materializeTemplatePartials(descriptor, port.localPartials());
      const { descriptor: resolved, issues } = resolveFormat(expanded, args.format);

      if (issues.length > 0) {
        return fail('invalid_template', invalidTemplateText({ message: 'Format', errors: issues }));
      }

      const timeline = videoTimeline(resolved);

      return capOutput(ok(timeline as unknown as Record<string, unknown>), 'The timeline is too large to return.');
    } catch (error) {
      return fail('invalid_template', error instanceof Error ? error.message : String(error));
    }
  },
});

export const VALIDATE_TOOLS = [validateTemplate, getTimeline];
