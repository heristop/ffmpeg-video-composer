import type { McpServer, ServerContext } from '@modelcontextprotocol/server';
import { applyJsonPatch, JsonPatchError } from 'ffmpeg-video-composer';
import { z } from 'zod';
import { effectKeyError, validateTemplate } from '../compose/validation.js';
import { templateRevision } from '../effects/template-revision.js';

// edit_template: a JSON Patch (RFC 6902) over inline template JSON, checked against the revision the agent
// last saw, all-or-nothing, and valid afterwards — or nothing changes. The template builder's browser
// tools (WebMCP) expose the same name with the same operations and revision contract, so an agent can
// author against either surface with one vocabulary.

type EffectValidator = (template: Record<string, unknown>, signal?: AbortSignal) => void | Promise<void>;

const operationSchema = z
  .object({
    op: z.enum(['add', 'remove', 'replace', 'move', 'copy', 'test']),
    path: z
      .string()
      .max(1000)
      .describe('RFC 6901 JSON Pointer from the template root, e.g. "/sections/1/options/duration".'),
    value: z.json().optional().describe('The value for add, replace and test.'),
    from: z.string().max(1000).optional().describe('The source pointer for move and copy.'),
  })
  .strict();

const inputSchema = z
  .object({
    template: z
      .unknown()
      .superRefine((raw, context) => {
        const message = effectKeyError(raw);

        if (message) context.addIssue({ code: 'custom', message });
      })
      .meta({ type: 'object' })
      .pipe(z.record(z.string(), z.json())),
    expectedRevision: z.string().describe('The revision validate_template (or a previous edit) returned.'),
    operations: z.array(operationSchema).min(1).max(100),
  })
  .strict();
type EditArgs = z.infer<typeof inputSchema>;

/** The patched template, its new revision and the paths the batch touched; throws, changing nothing, otherwise. */
export function editTemplate(input: unknown) {
  const args = inputSchema.parse(input);

  if (templateRevision(args.template) !== args.expectedRevision) {
    throw new Error('revision_conflict: template changed; use the revision returned by validate_template.');
  }

  let template: Record<string, unknown>;

  try {
    template = applyJsonPatch(args.template, args.operations, { maxOps: 100 });
  } catch (error) {
    if (error instanceof JsonPatchError) throw new Error(`${error.code}: ${error.message}`, { cause: error });

    throw error;
  }

  const validated = validateTemplate(template);

  if (!validated.ok) throw new Error(validated.message);

  return {
    template,
    revision: templateRevision(template),
    changedPaths: [...new Set(args.operations.map((operation) => operation.path))],
  };
}

function hasEffect(template: Record<string, unknown>): boolean {
  return (
    Array.isArray(template.sections) &&
    template.sections.some((section) => (section as { type?: unknown } | null)?.type === 'effect')
  );
}

export function registerEditTemplate(server: McpServer, validateEffects?: EffectValidator): void {
  server.registerTool(
    'edit_template',
    {
      title: 'Edit Template',
      description:
        'Apply a JSON Patch (RFC 6902: add, remove, replace, move, copy, test; RFC 6901 pointers) to inline template ' +
        'JSON atomically. Pass the revision validate_template returned as expectedRevision; a stale one fails with ' +
        'revision_conflict. The result must validate, or nothing changes. Returns the updated template, its new ' +
        'revision and the changed paths. For registered effect props, patch_template keeps partial structure.',
      inputSchema,
    },
    async (args: EditArgs, ctx?: ServerContext) => {
      try {
        ctx?.mcpReq.signal?.throwIfAborted();
        const result = editTemplate(args);

        if (hasEffect(result.template)) await validateEffects?.(result.template, ctx?.mcpReq.signal);

        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
        };
      }
    }
  );
}
