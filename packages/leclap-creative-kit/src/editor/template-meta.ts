import type { TemplateDescriptor, EditorState, EditableTemplate } from './model';

export function editorIdentityFrom(
  template: EditableTemplate
): Pick<EditorState, 'name' | 'description' | 'creativeDirection' | 'brief' | 'requirePurpose'> {
  const meta = template.descriptor.meta;

  // Embedded metadata wins per field; legacy descriptors retain the catalog identity. The brief switches
  // (meta.brief / meta.requirePurpose) have no control yet: carried through so a save never strips them.
  return {
    name: meta?.name ?? template.name,
    description: meta?.description ?? template.description,
    creativeDirection: meta?.creativeDirection,
    ...(meta?.brief === undefined ? {} : { brief: meta.brief }),
    ...(meta?.requirePurpose === undefined ? {} : { requirePurpose: meta.requirePurpose }),
  };
}

// The brief switches have no control yet: carried through untouched (blank brief dropped).
function briefFrom(state: EditorState): Pick<NonNullable<TemplateDescriptor['meta']>, 'brief' | 'requirePurpose'> {
  const brief = state.brief?.trim();

  return {
    ...(brief ? { brief } : {}),
    ...(state.requirePurpose === undefined ? {} : { requirePurpose: state.requirePurpose }),
  };
}

export function metaFrom(state: EditorState): Pick<TemplateDescriptor, 'meta'> {
  const name = state.name.trim();
  const description = state.description.trim();
  const creativeDirection = state.creativeDirection?.trim();
  const meta = {
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
    ...(creativeDirection ? { creativeDirection } : {}),
    ...briefFrom(state),
  };

  return Object.keys(meta).length > 0 ? { meta } : {};
}
