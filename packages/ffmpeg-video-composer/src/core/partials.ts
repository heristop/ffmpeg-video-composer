import { applyVariables } from './partial-variables';
// Template "partials": reusable section fragments referenced from a template via
// `{ "type": "partial", "ref": "<id>" }` instead of being copy-pasted. Expanded at load — before
// validation and compilation — so the schema, validator, and engine only ever see real sections.
//
// The engine owns the generic expansion MECHANISM only. The registry of available partials travels
// with the descriptor (`descriptor.partials`); a catalog (e.g. @leclap/creative-kit) supplies its own
// shared partials by merging them into `descriptor.partials` before compiling. Inline partials
// (`{ type: 'partial', sections: [...] }`) need no registry at all.
import type { TemplateDescriptor, Section, TemplatePartial } from '../schemas/template.schemas';

interface PartialRefSection {
  type: 'partial';
  ref?: string;
  prefix?: string;
  sections?: Section[];
  /** Values substituted into the partial's `{{ key }}` placeholders, so one partial serves many slots. */
  variables?: Record<string, string>;
}

function isPartialRef(section: Section): section is Section & PartialRefSection {
  return (section as { type?: string }).type === 'partial';
}

export function partialsById(partials: TemplatePartial[]): Record<string, TemplatePartial | undefined> {
  return Object.fromEntries(partials.map((partial) => [partial.id, partial]));
}

// Expand a single `{ type: "partial", ref }` section into its real sections: resolve the registry
// (or inline) sections, apply the partial's default variables merged under the ref's overrides, then
// prefix each section name. Throws on an unknown ref with no inline fallback.
function expandRefSection(
  section: Section & PartialRefSection,
  registry: Record<string, TemplatePartial | undefined>
): Section[] {
  const ref = (section.ref ?? '').trim();
  const partial = ref ? registry[ref] : undefined;
  const sourceSections = partial?.sections ?? section.sections;

  if (!sourceSections) {
    // An unconfigured partial (no ref picked yet) expands to nothing, so a half-authored template still
    // previews/compiles; the editor flags the missing ref separately. A NON-empty ref that resolves to
    // nothing is a real mistake (typo / removed partial), so that still throws.
    if (!ref) return [];

    throw new Error(`Unknown template partial: "${section.ref}"`);
  }

  // The partial's own defaults first, then the ref's overrides — so a ref can recolour/retext a
  // partial while unspecified keys keep the partial's built-in values.
  const variables = { ...partial?.variables, ...section.variables };
  const applied = (
    Object.keys(variables).length > 0 ? applyVariables(sourceSections, variables) : sourceSections
  ) as Section[];
  const prefix = section.prefix ?? '';

  return applied.map((s) => (prefix && typeof s.name === 'string' ? { ...s, name: `${prefix}${s.name}` } : s));
}

/**
 * Replace every `{ type: "partial", ref }` section with the referenced partial's real sections.
 * `prefix` (optional) is prepended to each expanded section's `name`, so the same partial can be
 * included more than once without name collisions. Idempotent (a descriptor with no partial refs is
 * returned unchanged) and throws on an unknown `ref`.
 */
export function expandPartialsWithRegistry(
  descriptor: TemplateDescriptor,
  partials: TemplatePartial[] = descriptor.partials ?? []
): TemplateDescriptor {
  // Guard against a malformed non-array `sections` (the Node compile path doesn't validate): `?? []`
  // only covers null/undefined, so a truthy non-array would otherwise crash `.some()`/the loop below.
  const sections = Array.isArray(descriptor.sections) ? descriptor.sections : [];

  if (!sections.some(isPartialRef)) {
    return descriptor;
  }

  return { ...descriptor, sections: expandSections(sections, partialsById(partials), []) };
}

// Expand refs recursively: a partial may itself contain partial refs, which must not survive into
// validation or compilation (the compiler would skip them silently). `stack` holds the refs being
// expanded so a partial that includes itself fails loudly instead of recursing forever.
function expandSections(
  sections: Section[],
  registry: Record<string, TemplatePartial | undefined>,
  stack: string[]
): Section[] {
  const expanded: Section[] = [];

  for (const section of sections) {
    if (!isPartialRef(section)) {
      expanded.push(section);
      continue;
    }

    const ref = (section.ref ?? '').trim();

    if (ref && stack.includes(ref)) {
      throw new Error(`Cyclic template partial: "${ref}"`);
    }

    const nested = ref ? [...stack, ref] : stack;
    expanded.push(...expandSections(expandRefSection(section, registry), registry, nested));
  }

  return expanded;
}

// Expand using the registry carried in the descriptor itself (`descriptor.partials`). Inline partials
// still expand with no registry.
export function expandPartials(descriptor: TemplateDescriptor): TemplateDescriptor {
  return expandPartialsWithRegistry(descriptor);
}

export type PartialExpansion =
  | { ok: true; data: unknown }
  | { ok: false; error: { path: string; message: string; code: string } };

/**
 * Validation-friendly wrapper around {@link expandPartials}: passes non-objects through untouched
 * and turns an unknown-ref throw into a structured error instead of an exception. Used by the
 * validator and director so partials are expanded before the schema + reference checks run.
 */
export function expandPartialsSafe(templateData: unknown): PartialExpansion {
  if (templateData === null || typeof templateData !== 'object') {
    return { ok: true, data: templateData };
  }

  try {
    return { ok: true, data: expandPartials(templateData) };
  } catch (error) {
    return {
      ok: false,
      error: {
        path: 'partial',
        message: error instanceof Error ? error.message : 'Unknown template partial',
        code: 'unknown_partial',
      },
    };
  }
}

export { assertEffectsResolved } from './assert-effects-resolved';
