import type { Template, TemplateDescriptor } from '@/src/types';
import { expandPartialsSafe } from '@leclap/creative-kit/partials';
import { SAMPLE_TEMPLATES, type CatalogTemplate } from './sampleTemplates';
import type { UserTemplate } from '@/src/stores/useUserTemplateStore';

/**
 * The local, serverless template catalog. The app no longer fetches `/templates` from a server —
 * the list is bundled samples plus whatever the user composed in the editor (persisted on-device).
 * Both are mapped to the UI's `Template` shape ({ name, content }).
 */

// Templates reference reusable section fragments as `{ type: 'partial', ref }` (e.g. the brand
// `logo-bumper-portrait`). Expand them here — at catalog load, before the cards read sections and
// before compile — against the bundled partial registry, so the validator and engine only ever see
// real sections (matches the web's materializeTemplatePartials and creative-kit's "expanded at load").
export const expandCatalogPartials = (descriptor: TemplateDescriptor): TemplateDescriptor => {
  const result = expandPartialsSafe(descriptor);

  if (result.ok) return result.data as TemplateDescriptor;

  // An unknown ref (e.g. a stale user template) must not break the whole catalog — leave the
  // descriptor raw so the rest of the list renders; its own compile surfaces the specific error.
  return descriptor;
};

const toTemplate = (entry: CatalogTemplate | UserTemplate): Template => ({
  id: entry.id,
  name: entry.name,
  content: expandCatalogPartials(entry.descriptor),
  source: entry.source,
});

/** User templates first (most recently created on top), then the bundled samples. */
export const buildCatalog = (userTemplates: UserTemplate[]): Template[] => [
  ...userTemplates.map(toTemplate),
  ...SAMPLE_TEMPLATES.map(toTemplate),
];

/** Resolve a single template by name across user templates then samples. */
export const findInCatalog = (userTemplates: UserTemplate[], name: string): Template | undefined =>
  buildCatalog(userTemplates).find((t) => t.name === name);
