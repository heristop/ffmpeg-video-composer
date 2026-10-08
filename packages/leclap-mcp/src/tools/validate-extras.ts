import { findingLine, invalidTemplateText, resolveTemplate, videoTimeline } from 'ffmpeg-video-composer';
import { z } from 'zod';

import { applyComposeFormat, formatArg } from '../compose/format.js';
import { fieldsArg, fieldValues, type FieldArgs } from '../compose/field-values.js';
import { effectKeyError, validateTemplate } from '../compose/validation.js';

// What validate_template adds on request (`include`), render-free:
// - "resolved": the descriptor compose_video's build starts from for these `fields` — partials expanded,
//   the declared global.fields filled with their typed values (a number lands in a numeric slot as a
//   number), then the requested format resolved. global.variables and form values stay as placeholders
//   (the engine fills them as it draws). A value the render would refuse is an error naming every field.
// - "timeline": where everything sits on the whole video — each section's absolute start/end, every
//   motion event (kinetic, graphic, camera, reveal, exit, transition) on video seconds, the beat grid and
//   the named cues. What an agent needs to pick render_frames moments or to line a hit up with a beat.

export const VALIDATE_INCLUDES = ['resolved', 'timeline'] as const;

export const extrasInput = {
  include: z
    .array(z.enum(VALIDATE_INCLUDES))
    .max(VALIDATE_INCLUDES.length)
    .optional()
    .describe(
      '"resolved" adds `resolved` { descriptor, values } for `fields` and `format`; "timeline" adds `timeline` ' +
        '(sections on video seconds, motion events, beats, cues; `approx` when a clip length is assumed).'
    ),
  fields: fieldsArg,
  format: formatArg.describe(
    'Format for `include` (landscape | portrait | square). Default: the template orientation.'
  ),
};

export const extrasOutput = {
  resolved: z
    .object({
      descriptor: z.record(z.string(), z.unknown()),
      values: z.record(z.string(), z.union([z.string(), z.number()])),
    })
    .optional(),
  timeline: z.record(z.string(), z.unknown()).optional(),
};

export type ExtrasArgs = {
  template: Record<string, unknown>;
  include?: ReadonlyArray<(typeof VALIDATE_INCLUDES)[number]>;
  fields?: FieldArgs;
  format?: z.infer<typeof formatArg>;
};

type ToolError = { isError: true; content: [{ type: 'text'; text: string }] };
type Extras = { resolved?: z.infer<typeof extrasOutput.resolved>; timeline?: Record<string, unknown> };

function toolError(text: string): ToolError {
  return { isError: true, content: [{ type: 'text', text }] };
}

/** The descriptor a render would start from for these fields and format, or the findings it would refuse. */
export function resolvedExtra(args: ExtrasArgs): { resolved: NonNullable<Extras['resolved']> } | ToolError {
  const keyError = effectKeyError(args.template);

  if (keyError) return toolError(keyError);

  const result = resolveTemplate(args.template, fieldValues(args.fields) ?? {}, { format: args.format });

  if (result.errors.length > 0) {
    const lines = result.errors.map((error) => `${findingLine(error)} [${error.code}]`);

    return toolError(
      `A render would refuse this template with these fields (${lines.length} finding(s)):\n- ${lines.join('\n- ')}`
    );
  }

  return { resolved: { descriptor: result.descriptor as Record<string, unknown>, values: result.values } };
}

/** The whole-video timeline of the template in the requested format. */
export function timelineExtra(args: ExtrasArgs): { timeline: Record<string, unknown> } | ToolError {
  const formatted = applyComposeFormat({ template: args.template, format: args.format });

  if ('isError' in formatted) return formatted;

  const validation = validateTemplate(formatted.template);

  if (!validation.ok) return toolError(invalidTemplateText(validation));

  return { timeline: videoTimeline(validation.descriptor) as unknown as Record<string, unknown> };
}

/** Every requested extra, or the first error. Nothing is computed when `include` is absent. */
export function validateExtras(args: ExtrasArgs): Extras | ToolError {
  const include = new Set(args.include ?? []);
  let extras: Extras = {};

  if (include.has('resolved')) {
    const resolved = resolvedExtra(args);

    if ('isError' in resolved) return resolved;
    extras = { ...extras, ...resolved };
  }

  if (include.has('timeline')) {
    const timeline = timelineExtra(args);

    if ('isError' in timeline) return timeline;
    extras = { ...extras, ...timeline };
  }

  return extras;
}

// The requested extras ride in structuredContent and, for clients without structured output, as a
// second JSON text block.
export function withExtras<R extends { content: { type: 'text'; text: string }[]; structuredContent: object }>(
  result: R,
  extras: object
): R {
  if (Object.keys(extras).length === 0) return result;

  return {
    ...result,
    content: [...result.content, { type: 'text' as const, text: JSON.stringify(extras) }],
    structuredContent: { ...result.structuredContent, ...extras },
  };
}
