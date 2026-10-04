import type { TemplateDescriptor, EditorState, EditableTemplate } from './model';

export function editorIdentityFrom(
  template: EditableTemplate
): Pick<EditorState, 'name' | 'description' | 'creativeDirection'> {
  // Embedded metadata wins per field; legacy descriptors retain the catalog identity.
  return {
    name: template.descriptor.meta?.name ?? template.name,
    description: template.descriptor.meta?.description ?? template.description,
    creativeDirection: template.descriptor.meta?.creativeDirection,
  };
}

export function metaFrom(state: EditorState): Pick<TemplateDescriptor, 'meta'> {
  const name = state.name.trim();
  const description = state.description.trim();
  const creativeDirection = state.creativeDirection?.trim();

  if (!name && !description && !creativeDirection) return {};

  return {
    meta: {
      ...(name ? { name } : {}),
      ...(description ? { description } : {}),
      ...(creativeDirection ? { creativeDirection } : {}),
    },
  };
}
