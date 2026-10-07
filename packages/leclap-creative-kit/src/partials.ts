// Template "partials": reusable section fragments referenced from a template via
// `{ "type": "partial", "ref": "<id>" }` instead of being copy-pasted. Expanded at load — before
// validation and compilation — so the schema, validator, and engine only ever see real sections.
import type { TemplateDescriptor, TemplatePartial } from './types';
// APP_PARTIALS is generated from src/partials/*.json by scripts/gen-partials.ts — declare a partial
// by dropping a JSON in src/partials/ (id = filename) and running `pnpm gen:partials`, no edit here.
import { APP_PARTIALS } from './partials.generated';
import { expandPartialsWithRegistry as engineExpand } from 'ffmpeg-video-composer/src/core/partials.ts';

type EngineDescriptor = Parameters<typeof engineExpand>[0];
type EnginePartial = NonNullable<Parameters<typeof engineExpand>[1]>[number];

// TemplatePartial lives in ./types (so the generated registry can reference it without a cycle);
// re-exported here to keep `@leclap/creative-kit/partials` the single import site for consumers.
export type { TemplatePartial };

export { APP_PARTIALS };

export function partialsById(partials: TemplatePartial[]): Record<string, TemplatePartial | undefined> {
  return Object.fromEntries(partials.map((partial) => [partial.id, partial]));
}

/**
 * Replace every `{ type: "partial", ref }` section with the referenced partial's real sections.
 * `prefix` (optional) is prepended to each expanded section's `name`, so the same partial can be
 * included more than once without name collisions. Idempotent (a descriptor with no partial refs is
 * returned unchanged) and throws on an unknown `ref`.
 *
 * Delegates to the engine's expansion so the editor previews exactly what renders: nested partials,
 * `{{ key }}` variables, a ref `duration` that stretches only the partial's hold, its sync points
 * exported as `cue:<id>`, and an `align` onto a beat or cue.
 */
export function expandPartialsWithRegistry(
  descriptor: TemplateDescriptor,
  partials: TemplatePartial[] = APP_PARTIALS
): TemplateDescriptor {
  return engineExpand(descriptor as EngineDescriptor, partials as EnginePartial[]) as TemplateDescriptor;
}

export function expandPartials(descriptor: TemplateDescriptor): TemplateDescriptor {
  return expandPartialsWithRegistry(descriptor, APP_PARTIALS);
}

export type PartialExpansion =
  | { ok: true; data: unknown }
  | { ok: false; error: { path: string; message: string; code: string } };

/**
 * Validation-friendly wrapper around {@link expandPartials}: passes non-objects through untouched
 * and turns an unknown-ref throw into a structured error instead of an exception. Used by the
 * validator so partials are expanded before the schema + reference checks run.
 */
export function expandPartialsSafe(templateData: unknown): PartialExpansion {
  if (templateData === null || typeof templateData !== 'object') {
    return { ok: true, data: templateData };
  }

  try {
    return { ok: true, data: expandPartials(templateData as TemplateDescriptor) };
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
