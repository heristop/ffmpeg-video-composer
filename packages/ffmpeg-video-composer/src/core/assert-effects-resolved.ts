import { applyVariables } from './partial-variables';
import type { TemplateDescriptor } from '../schemas/template.schemas';

/** Fail before composition if an active section (including a nested partial) still needs an effect backend. */
export function assertEffectsResolved(descriptor: unknown): TemplateDescriptor {
  if (!descriptor || typeof descriptor !== 'object') return descriptor as TemplateDescriptor;

  const template = descriptor as { sections?: unknown; partials?: unknown };
  const registry = new Map<string, unknown>();

  if (Array.isArray(template.partials)) {
    for (const partial of template.partials) {
      if (partial && typeof partial === 'object' && typeof partial.id === 'string') {
        registry.set(partial.id, partial);
      }
    }
  }

  const active = new Set<unknown>();
  function check(sections: unknown, variables: Record<string, string> = {}): void {
    if (!Array.isArray(sections) || active.has(sections)) return;
    active.add(sections);

    for (const section of applyVariables(sections, variables)) checkSection(section);
    active.delete(sections);
  }

  function checkSection(section: unknown): void {
    if (!section || typeof section !== 'object') return;
    const candidate = section as {
      type?: string;
      name?: string;
      ref?: string;
      sections?: unknown;
      variables?: Record<string, string>;
    };

    if (candidate.type === 'effect') {
      throw new Error(
        `effect_backend_unavailable: section "${candidate.name ?? '(unnamed)'}" must be resolved before composition`
      );
    }

    if (candidate.type !== 'partial') return;
    const ref = typeof candidate.ref === 'string' ? candidate.ref.trim() : '';
    const partial = registry.get(ref) as { sections?: unknown; variables?: Record<string, string> } | undefined;
    check(partial?.sections ?? candidate.sections, { ...partial?.variables, ...candidate.variables });
  }

  check(template.sections);

  return descriptor;
}
