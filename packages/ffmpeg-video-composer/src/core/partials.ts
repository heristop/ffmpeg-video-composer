import { applyVariables } from './partial-variables';
import { PartialError } from './partial-error';
import { applyAlign, type AlignRecord } from './partial-align';
import { timePartial, type PartialFinding } from './partial-timing';
// Template "partials": reusable section fragments referenced from a template via
// `{ "type": "partial", "ref": "<id>" }` instead of being copy-pasted. Expanded at load — before
// validation and compilation — so the schema, validator, and engine only ever see real sections.
//
// The engine owns the generic expansion MECHANISM only. The registry of available partials travels
// with the descriptor (`descriptor.partials`); a catalog (e.g. @leclap/creative-kit) supplies its own
// shared partials by merging them into `descriptor.partials` before compiling. Inline partials
// (`{ type: 'partial', sections: [...] }`) need no registry at all.
//
// A ref may also re-time its partial: `duration` stretches only the hold of the partial envelope
// (core/partial-envelope.ts), every sync point becomes a `cue:<id>` of the section it falls in, and
// `align` resizes the section before the ref so a sync point lands on a beat or cue
// (core/partial-align.ts). Refs without those fields expand exactly as before.
import type { TemplateDescriptor, Section, TemplatePartial } from '../schemas/template.schemas';

export { PartialError } from './partial-error';
export type { PartialFinding } from './partial-timing';

interface PartialRefSection {
  type: 'partial';
  ref?: string;
  prefix?: string;
  sections?: Section[];
  /** Values substituted into the partial's `{{ key }}` placeholders, so one partial serves many slots. */
  variables?: Record<string, string>;
  align?: unknown;
}

type Registry = Record<string, TemplatePartial | undefined>;
type Bag = Record<string, unknown>;

interface Expanded {
  sections: Section[];
  aligns: AlignRecord[];
  warnings: PartialFinding[];
}

function isPartialRef(section: Section): section is Section & PartialRefSection {
  return (section as { type?: string }).type === 'partial';
}

export function partialsById(partials: TemplatePartial[]): Registry {
  return Object.fromEntries(partials.map((partial) => [partial.id, partial]));
}

// The registry (or inline) sections of a ref with the partial's default variables merged under the ref's
// overrides. Null for an unconfigured ref (no ref picked yet): it expands to nothing, so a half-authored
// template still previews/compiles. A NON-empty ref that resolves to nothing is a real mistake (typo /
// removed partial), so that still throws.
function sourceSections(
  section: Section & PartialRefSection,
  partial: TemplatePartial | undefined,
  path: string
): Section[] | null {
  const sections = partial?.sections ?? section.sections;

  if (!sections) {
    if (!(section.ref ?? '').trim()) return null;

    throw new PartialError(`${path}.ref`, 'unknown_partial', `Unknown template partial: "${section.ref}"`);
  }

  // The partial's own defaults first, then the ref's overrides — so a ref can recolour/retext a
  // partial while unspecified keys keep the partial's built-in values.
  const variables = { ...partial?.variables, ...section.variables };

  return (Object.keys(variables).length > 0 ? applyVariables(sections, variables) : sections) as Section[];
}

function withPrefix(sections: Section[], prefix: string): Section[] {
  return sections.map((s) => (prefix && typeof s.name === 'string' ? { ...s, name: `${prefix}${s.name}` } : s));
}

// Expand one ref: its nested refs first (so the timing sees real sections), then its timing, then the
// name prefix. `path` is the authored top-level ref; `depth` > 0 inside another partial.
function expandRef(section: Section & PartialRefSection, registry: Registry, stack: string[], path: string): Expanded {
  const ref = (section.ref ?? '').trim();

  if (ref && stack.includes(ref)) {
    throw new PartialError(path, 'cyclic_partial', `Cyclic template partial: "${ref}"`);
  }

  const partial = ref ? registry[ref] : undefined;
  const source = sourceSections(section, partial, path);

  if (!source) return { sections: [], aligns: [], warnings: [] };

  if (stack.length > 0 && section.align !== undefined) {
    throw new PartialError(`${path}.align`, 'align_nested', 'align is only supported on top-level partial refs');
  }

  const inner = expandSections(source, registry, ref ? [...stack, ref] : stack, path);
  const timed = timePartial(inner.sections, partial, section as unknown as Bag, path);
  const align = timed.align && { path, first: 0, ...timed.align };

  return {
    sections: withPrefix(timed.sections as Section[], section.prefix ?? ''),
    aligns: align ? [align] : [],
    warnings: [...inner.warnings, ...timed.warnings],
  };
}

// Expand refs recursively: a partial may itself contain partial refs, which must not survive into
// validation or compilation (the compiler would skip them silently). `stack` holds the refs being
// expanded so a partial that includes itself fails loudly instead of recursing forever.
function expandSections(sections: Section[], registry: Registry, stack: string[], parentPath?: string): Expanded {
  const out: Expanded = { sections: [], aligns: [], warnings: [] };

  for (const [index, section] of sections.entries()) {
    if (!isPartialRef(section)) {
      out.sections.push(section);
      continue;
    }

    const expanded = expandRef(section, registry, stack, parentPath ?? `sections[${index}]`);
    const base = out.sections.length;

    out.aligns.push(...expanded.aligns.map((a) => ({ ...a, first: a.first + base, syncIndex: a.syncIndex + base })));
    out.warnings.push(...expanded.warnings);
    out.sections.push(...expanded.sections);
  }

  return out;
}

/**
 * The expanded descriptor plus the advisory findings of the expansion (`partial_compressed`). Throws a
 * {@link PartialError} on an unknown ref, a cycle, or a duration/align the partial cannot honour.
 */
export function expandPartialsReport(
  descriptor: TemplateDescriptor,
  partials: TemplatePartial[] = descriptor.partials ?? []
): { descriptor: TemplateDescriptor; warnings: PartialFinding[] } {
  // Guard against a malformed non-array `sections` (the Node compile path doesn't validate): `?? []`
  // only covers null/undefined, so a truthy non-array would otherwise crash `.some()`/the loop below.
  const sections = Array.isArray(descriptor.sections) ? descriptor.sections : [];

  if (!sections.some(isPartialRef)) {
    return { descriptor, warnings: [] };
  }

  const expanded = expandSections(sections, partialsById(partials), []);
  const out = expanded.sections as unknown as Bag[];

  for (const record of expanded.aligns) applyAlign(out, descriptor.global ?? {}, record);

  return { descriptor: { ...descriptor, sections: out as unknown as Section[] }, warnings: expanded.warnings };
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
  return expandPartialsReport(descriptor, partials).descriptor;
}

// Expand using the registry carried in the descriptor itself (`descriptor.partials`). Inline partials
// still expand with no registry.
export function expandPartials(descriptor: TemplateDescriptor): TemplateDescriptor {
  return expandPartialsWithRegistry(descriptor);
}

export type PartialExpansion =
  | { ok: true; data: unknown; warnings?: PartialFinding[] }
  | { ok: false; error: { path: string; message: string; code: string; hint?: string } };

function expansionError(error: unknown): Extract<PartialExpansion, { ok: false }> {
  if (error instanceof PartialError) {
    const { path, code, message, hint } = error;

    return { ok: false, error: { path, message, code, ...(hint && { hint }) } };
  }

  return {
    ok: false,
    error: {
      path: 'partial',
      message: error instanceof Error ? error.message : 'Unknown template partial',
      code: 'unknown_partial',
    },
  };
}

/**
 * Validation-friendly wrapper around {@link expandPartials}: passes non-objects through untouched
 * and turns an expansion throw into a structured error instead of an exception. Used by the
 * validator and director so partials are expanded before the schema + reference checks run.
 */
export function expandPartialsSafe(templateData: unknown): PartialExpansion {
  if (templateData === null || typeof templateData !== 'object') {
    return { ok: true, data: templateData };
  }

  try {
    const { descriptor, warnings } = expandPartialsReport(templateData);

    return warnings.length > 0 ? { ok: true, data: descriptor, warnings } : { ok: true, data: descriptor };
  } catch (error) {
    return expansionError(error);
  }
}

export { assertEffectsResolved } from './assert-effects-resolved';
