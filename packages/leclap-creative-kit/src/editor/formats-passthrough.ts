// Per-format compositions (descriptor.formats) have no builder controls yet. The editor carries them
// through in descriptor shape, so opening a multi-format template and saving it never strips them.
// The builder renames sections on save (color_1, video_1…), while `formats.<format>.sections` patches
// sections BY NAME, so the original names are kept alongside and the patch keys follow the rename.

import type { TemplateDescriptor } from 'ffmpeg-video-composer/src/core/types.d.ts';
import type { TemplateFormats } from 'ffmpeg-video-composer/src/schemas/formats.schemas.ts';

type DescriptorSection = NonNullable<TemplateDescriptor['sections']>[number];

export interface EditorFormats {
  /** descriptor.formats, verbatim. */
  overrides: TemplateFormats;
  /** The loaded name of each positional editor section, in order (null for a partial: its inner
   * sections keep their own names, so their patches never need renaming). */
  sectionNames: (string | null)[];
}

// The descriptor sections the editor turns into positional sections (to-editor-state.ts): partials and
// named sections, in order.
function positionalNames(sections: readonly DescriptorSection[]): (string | null)[] {
  return sections
    .filter((section) => section.type === 'partial' || typeof section.name === 'string')
    .map((section) => (section.type === 'partial' ? null : (section.name as string)));
}

/** descriptor.formats as editor state, or undefined when the template declares none. */
export function editorFormatsFrom(descriptor: TemplateDescriptor): EditorFormats | undefined {
  if (!descriptor.formats) return undefined;

  return { overrides: descriptor.formats, sectionNames: positionalNames(descriptor.sections ?? []) };
}

function renamedSections(
  patches: Record<string, unknown> | undefined,
  renames: Map<string, string>
): Record<string, unknown> | undefined {
  if (!patches) return patches;

  return Object.fromEntries(Object.entries(patches).map(([name, patch]) => [renames.get(name) ?? name, patch]));
}

// Old name -> emitted name, when the saved sections still line up one-to-one with the loaded ones.
// Otherwise (sections added, removed or reordered) the keys are kept; validation names any that dangle.
function sectionRenames(formats: EditorFormats, emitted: readonly DescriptorSection[]): Map<string, string> {
  const renames = new Map<string, string>();

  if (emitted.length !== formats.sectionNames.length) return renames;

  for (const [index, name] of formats.sectionNames.entries()) {
    const next = emitted[index];

    if (name !== null && next.type !== 'partial' && typeof next.name === 'string') renames.set(name, next.name);
  }

  return renames;
}

/** The `formats` field to emit for the saved sections, with section patch keys following the rename. */
export function formatsField(
  formats: EditorFormats | undefined,
  emitted: readonly DescriptorSection[]
): Pick<TemplateDescriptor, 'formats'> {
  if (!formats) return {};

  const renames = sectionRenames(formats, emitted);
  const entries = Object.entries(formats.overrides).map(([format, override]) => [
    format,
    override.sections ? { ...override, sections: renamedSections(override.sections, renames) } : override,
  ]);

  return { formats: Object.fromEntries(entries) as TemplateFormats };
}
