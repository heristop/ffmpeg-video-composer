import { expandPartialsSafe } from 'ffmpeg-video-composer';
import { z } from 'zod';
import { unsafeEffectValue } from '../compose/validation.js';

// edit_template `effectProps`: replace registered effect props by section name. Names are the expanded
// ones (partial prefixes and variables applied), so an effect inside a partial is addressable where a
// JSON Pointer is not; editing a registry partial materializes only that instance.

// The SDK parses this schema before invoking the handler. Run the bounded raw-key
// gate before JSON records can remove __proto__, retaining object discovery metadata.
export function guardedJsonObject(check: (raw: unknown) => string | undefined) {
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

export const effectPropsArg = z
  .array(editSchema)
  .min(1)
  .max(100)
  .optional()
  .describe('Effect props merged by expanded section name (partial prefix included), after `operations`.');
export type EffectPropsEdit = z.infer<typeof editSchema>;
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

/**
 * Apply the effect prop edits to `template` in place (the caller passes a copy) and return the edited
 * section names. Throws on an unknown, ambiguous or duplicate edit.
 */
export function applyEffectProps(template: Record<string, unknown>, edits: readonly EffectPropsEdit[]): string[] {
  const sections = template.sections;

  if (!Array.isArray(sections)) throw new Error('Template sections must be an array.');

  const seen = new Set<string>();

  for (const edit of edits) {
    applyEdit(sections, template.partials as JsonObject[string], edit, seen);
  }

  return [...new Set(edits.map((edit) => edit.section))];
}
