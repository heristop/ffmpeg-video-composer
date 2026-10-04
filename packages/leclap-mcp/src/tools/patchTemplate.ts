import type { McpServer, ServerContext } from '@modelcontextprotocol/server';
import { expandPartialsSafe } from 'ffmpeg-video-composer';
import { z } from 'zod';
import { validateTemplate, effectKeyError, unsafeEffectValue } from '../compose/validation.js';
import { templateRevision } from '../effects/template-revision.js';

// The SDK parses this schema before invoking the handler. Run the bounded raw-key
// gate before JSON records can remove __proto__, retaining object discovery metadata.
function guardedJsonObject(check: (raw: unknown) => string | undefined) {
  return z
    .unknown()
    .superRefine((raw, context) => {
      const message = check(raw);

      if (message) context.addIssue({ code: 'custom', message });
    })
    .meta({ type: 'object' })
    .pipe(z.record(z.string(), z.json()));
}

const editSchema = z
  .object({
    section: z.string().min(1),
    props: guardedJsonObject((raw) => unsafeEffectValue([raw])),
  })
  .strict();
const inputSchema = z
  .object({
    template: guardedJsonObject(effectKeyError),
    expectedRevision: z.string(),
    edits: z.array(editSchema).min(1),
  })
  .strict();
type PatchArgs = z.infer<typeof inputSchema>;

type EffectValidator = (template: Record<string, unknown>, signal?: AbortSignal) => void | Promise<void>;

type JsonObject = Record<string, z.infer<ReturnType<typeof z.json>>>;

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

type SectionMatch = { section: JsonObject; partial?: JsonObject; index: number };

function expandedSections(section: JsonObject, partials: JsonObject[string]): unknown[] {
  const expanded = expandPartialsSafe({ sections: [section], partials });

  if (!expanded.ok) throw new Error(`Invalid template: ${expanded.error.message}`);

  return isObject(expanded.data) && Array.isArray(expanded.data.sections) ? expanded.data.sections : [];
}

function matchingSections(sections: unknown[], partials: JsonObject[string], name: string): SectionMatch[] {
  return sections.flatMap((section) => {
    if (!isObject(section)) return [];

    return expandedSections(section, partials).flatMap((candidate, index) =>
      isObject(candidate) && candidate.name === name
        ? [{ section: candidate, partial: section.type === 'partial' ? section : undefined, index }]
        : []
    );
  });
}

function materializeRegisteredPartial(partial: JsonObject, partials: JsonObject[string]): void {
  const ref = typeof partial.ref === 'string' ? partial.ref.trim() : '';
  const definition = Array.isArray(partials)
    ? partials.findLast((candidate) => ref && isObject(candidate) && candidate.id === ref)
    : undefined;

  if (!isObject(definition) || !Array.isArray(definition.sections)) return;
  partial.sections = structuredClone(definition.sections);

  if (isObject(definition.variables) || isObject(partial.variables)) {
    partial.variables = {
      ...(isObject(definition.variables) ? definition.variables : {}),
      ...(isObject(partial.variables) ? partial.variables : {}),
    };
  }
  delete partial.ref;
}

function authoredSection(match: SectionMatch, partials: JsonObject[string]): JsonObject {
  if (!match.partial) return match.section;

  materializeRegisteredPartial(match.partial, partials);
  // Core partial expansion retains source order: effective names include variables and prefixes,
  // but the edit belongs at the same index in this instance's authored source.
  const source = Array.isArray(match.partial.sections) ? match.partial.sections[match.index] : undefined;

  if (!isObject(source)) throw new Error('Invalid partial source for selected effect section.');

  return source;
}

function applyEdit(
  sections: unknown[],
  partials: JsonObject[string],
  edit: z.infer<typeof editSchema>,
  seen: Set<string>
): void {
  const matches = matchingSections(sections, partials, edit.section);

  if (matches.length > 1) {
    throw new Error(`Ambiguous section name: ${edit.section}`);
  }
  const match = matches.at(0);

  if (match?.section.type !== 'effect') {
    throw new Error(`Unknown effect section: ${edit.section}`);
  }
  const section = authoredSection(match, partials);
  const effect = section.effect;

  if (!isObject(effect)) {
    throw new Error(`Invalid effect reference: ${edit.section}`);
  }

  for (const property of Object.keys(edit.props)) {
    const key = `${edit.section}\0${property}`;

    if (seen.has(key)) {
      throw new Error(`Duplicate property edit: ${edit.section}.${property}`);
    }
    seen.add(key);
  }
  effect.props = { ...(isObject(effect.props) ? effect.props : {}), ...edit.props };
}

/** Apply a complete edit batch to a copy. A conflict or invalid edit never changes caller state. */
export function patchTemplate(input: unknown) {
  const args = inputSchema.parse(input);

  if (templateRevision(args.template) !== args.expectedRevision) {
    throw new Error('revision_conflict: template changed; use the revision returned by validate_template.');
  }
  const template = structuredClone(args.template);
  const sections = template.sections;

  if (!Array.isArray(sections)) {
    throw new Error('Template sections must be an array.');
  }
  const seen = new Set<string>();

  for (const edit of args.edits) {
    applyEdit(sections, template.partials, edit, seen);
  }
  const validated = validateTemplate(template);

  if (!validated.ok) {
    throw new Error(validated.message);
  }

  return {
    template,
    revision: templateRevision(template),
    changedSections: [...new Set(args.edits.map((edit) => edit.section))],
  };
}

export function registerPatchTemplate(server: McpServer, validateEffects?: EffectValidator): void {
  server.registerTool(
    'patch_template',
    {
      title: 'Patch Template',
      description:
        'Atomically replace selected effect props in inline JSON. Use expanded section names including partial prefixes; editing a registry partial materializes only that instance. Pass the expected revision from validate_template. Returns updated JSON and revision; never rewrites effect source.',
      inputSchema,
    },
    async (args: PatchArgs, ctx?: ServerContext) => {
      try {
        ctx?.mcpReq.signal?.throwIfAborted();
        const result = patchTemplate(args);
        await validateEffects?.(result.template, ctx?.mcpReq.signal);

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
