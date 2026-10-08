import type { TemplateDescriptor, EditorState, EditableTemplate } from './model';

export function editorIdentityFrom(
  template: EditableTemplate
): Pick<EditorState, 'name' | 'description' | 'creativeDirection' | 'brief' | 'requirePurpose' | 'resolved'> {
  const meta = template.descriptor.meta;

  // Embedded metadata wins per field; legacy descriptors retain the catalog identity. The brief switches
  // (meta.brief / meta.requirePurpose) have no control yet: carried through so a save never strips them.
  return {
    name: meta?.name ?? template.name,
    description: meta?.description ?? template.description,
    creativeDirection: meta?.creativeDirection,
    ...(meta?.brief === undefined ? {} : { brief: meta.brief }),
    ...(meta?.requirePurpose === undefined ? {} : { requirePurpose: meta.requirePurpose }),
    // Pinned transcripts (meta.resolved) are written by resolve passes, never edited here.
    ...(meta?.resolved === undefined ? {} : { resolved: meta.resolved }),
  };
}

// The brief switches have no control yet: carried through untouched (blank brief dropped).
function briefFrom(
  state: EditorState
): Pick<NonNullable<TemplateDescriptor['meta']>, 'brief' | 'requirePurpose' | 'resolved'> {
  const brief = state.brief?.trim();

  return {
    ...(brief ? { brief } : {}),
    ...(state.requirePurpose === undefined ? {} : { requirePurpose: state.requirePurpose }),
    ...(state.resolved === undefined ? {} : { resolved: state.resolved }),
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

type Resolved = NonNullable<EditorState['resolved']>;

/**
 * The pinned transcripts under the section names the builder emits: an import renames sections (talk →
 * video_1), so each record's key and source (`from`) follow the section at the same position in `origins`
 * (the imported names) and `emitted` (the builder's names). Records of unknown sections are kept.
 */
export function renameTranscripts(
  resolved: Resolved,
  origins: ReadonlyArray<string | undefined>,
  emitted: ReadonlyArray<string | undefined>
): Resolved {
  const transcripts = resolved.transcripts;

  if (!transcripts) return resolved;

  const renames = new Map(
    origins.flatMap((origin, index): Array<[string, string]> => {
      const name = emitted[index];

      return origin && name ? [[origin, name]] : [];
    })
  );
  const renamed = Object.entries(transcripts).map(([section, record]) => [
    renames.get(section) ?? section,
    { ...record, from: renames.get(record.from) ?? record.from },
  ]);

  return { ...resolved, transcripts: Object.fromEntries(renamed) };
}
