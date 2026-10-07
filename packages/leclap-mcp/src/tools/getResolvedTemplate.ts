import type { McpServer } from '@modelcontextprotocol/server';
import { findingLine, resolveTemplate } from 'ffmpeg-video-composer';
import { z } from 'zod';

import { formatArg } from '../compose/format.js';
import { fieldsArg, fieldValues } from '../compose/field-values.js';
import { effectKeyError } from '../compose/validation.js';

// get_resolved_template: the descriptor compose_video's build starts from for these `fields`, render-free —
// partials expanded, the declared global.fields filled with their typed values (a number lands in a numeric
// slot as a number), then the requested format resolved. global.variables and form values stay as
// placeholders (the engine fills them as it draws). What an agent reads to check a field went where it meant
// before paying for a render. A value the render would refuse is an error naming every field.

const inputSchema = z.object({ template: z.record(z.string(), z.unknown()), fields: fieldsArg, format: formatArg });

const outputSchema = z.object({
  descriptor: z.record(z.string(), z.unknown()),
  values: z.record(z.string(), z.union([z.string(), z.number()])),
});

type ResolvedArgs = z.infer<typeof inputSchema>;

export function resolvedTemplateResult(args: ResolvedArgs) {
  const keyError = effectKeyError(args.template);

  if (keyError) return { isError: true as const, content: [{ type: 'text' as const, text: keyError }] };

  const result = resolveTemplate(args.template, fieldValues(args.fields) ?? {}, { format: args.format });

  if (result.errors.length > 0) {
    const lines = result.errors.map((error) => `${findingLine(error)} [${error.code}]`);
    const text = `A render would refuse this template with these fields (${lines.length} finding(s)):\n- ${lines.join('\n- ')}`;

    return { isError: true as const, content: [{ type: 'text' as const, text }] };
  }

  const structuredContent = { descriptor: result.descriptor as Record<string, unknown>, values: result.values };

  return { content: [{ type: 'text' as const, text: JSON.stringify(structuredContent) }], structuredContent };
}

export function registerGetResolvedTemplate(server: McpServer): void {
  server.registerTool(
    'get_resolved_template',
    {
      title: 'Get Resolved Template',
      description:
        'Return the descriptor compose_video starts its build from for these `fields`, without rendering: ' +
        'partials expanded, the declared global.fields filled with their typed values (whole-string ' +
        '"{{ NAME }}" placeholders become numbers in numeric slots), then the format resolved. ' +
        'global.variables and form values stay as placeholders; the engine fills them as it draws. ' +
        "`values` holds each declared field's typed value. A missing required value, or one that fails its " +
        'type or its slot, is an error naming the field.',
      inputSchema,
      outputSchema,
    },
    (args: ResolvedArgs) => resolvedTemplateResult(args)
  );
}
