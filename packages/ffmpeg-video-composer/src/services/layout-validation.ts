// Section layouts (schemas/layout.schemas.ts) beyond the schema: the section type must render a frame,
// every pane source must name something drawable, and a wipe must start inside the section.

import type { TemplateDescriptor } from '../schemas/template.schemas';
import { LAYOUT_SECTION_TYPES, type SectionLayout } from '../schemas/layout.schemas';
import { classifyLayoutSource, type LayoutSectionRef } from '@/core/layout/sources';
import { nearest } from './validation/suggest';
import type { ValidationError } from './validation/types';

interface LayoutOwner {
  name?: string;
  type: string;
  layout?: SectionLayout;
  options?: { duration?: number };
}

function refsOf(layout: SectionLayout): Array<{ ref: string; path: string }> {
  if (layout.type === 'split') return layout.sources.map((ref, index) => ({ ref, path: `sources[${index}]` }));

  return [
    { ref: layout.before, path: 'before' },
    { ref: layout.after, path: 'after' },
  ];
}

function sourceErrors(owner: LayoutOwner, sections: readonly LayoutSectionRef[], path: string): ValidationError[] {
  const names = sections.flatMap((section) => (section.name ? [section.name] : []));

  return refsOf(owner.layout as SectionLayout).flatMap(({ ref, path: field }) => {
    if (classifyLayoutSource(ref, sections, owner.name ?? '')) return [];

    const suggestion = nearest(ref, names);
    const named = names.includes(ref);

    return [
      {
        path: `${path}.layout.${field}`,
        message: named
          ? `section "${ref}" shows no media a pane can reuse (no backgroundColor, pictureUrl, videoUrl or clip)`
          : `"${ref}" is not a section name, a media URL/path or a #RRGGBB colour`,
        code: 'unknown_layout_source',
        hint: 'Name a color_background, image_background, video or project_video section, a media URL, or a #colour.',
        ...(suggestion && !named ? { suggestion, kind: 'judgement' as const } : {}),
      },
    ];
  });
}

function wipeErrors(owner: LayoutOwner, path: string): ValidationError[] {
  const layout = owner.layout;
  const duration = owner.options?.duration;

  if (layout?.type !== 'before-after' || duration === undefined || layout.wipe.at < duration) return [];

  return [
    {
      path: `${path}.layout.wipe.at`,
      message: `the wipe starts at ${layout.wipe.at}s, at or after the section end (${duration}s): it never shows`,
      code: 'layout_wipe_out_of_range',
      hint: 'Start the wipe inside the section, leaving it time to finish.',
      kind: 'judgement',
    },
  ];
}

export function validateLayouts(template: TemplateDescriptor): ValidationError[] {
  const sections = (template.sections ?? []) as unknown as LayoutOwner[];

  return sections.flatMap((section, index) => {
    const path = `sections[${index}]`;

    if (!section.layout) return [];

    if (!(LAYOUT_SECTION_TYPES as readonly string[]).includes(section.type)) {
      return [
        {
          path: `${path}.layout`,
          message: `a ${section.type} section has no frame to lay out; layout works on ${LAYOUT_SECTION_TYPES.join(', ')}`,
          code: 'layout_unsupported_section',
          hint: 'Move the layout to a color_background (or image/video) section.',
          kind: 'judgement',
        },
      ];
    }

    return [...sourceErrors(section, sections as LayoutSectionRef[], path), ...wipeErrors(section, path)];
  });
}
