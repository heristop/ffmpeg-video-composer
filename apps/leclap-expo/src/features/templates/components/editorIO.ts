// Import / export a template as descriptor JSON — the same document the engine compiles, so a file
// exported here loads on web/server/MCP too. Export shares the JSON via the OS share sheet; import
// picks a .json file, validates it against the descriptor schema, and folds it into a fresh state.
import { Share } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { TemplateDescriptorSchema } from 'ffmpeg-video-composer/src/schemas/template.schemas.ts';
import { buildDescriptor, toEditorState, type EditorState, type EditableTemplate } from '../model/templateEditorModel';

export async function exportTemplate(state: EditorState): Promise<void> {
  const json = JSON.stringify(buildDescriptor(state), null, 2);

  await Share.share({ message: json, title: `${state.name.trim() || 'template'}.json` });
}

// Returns the imported editor state, or null when the user cancels. Throws when the file isn't a
// valid template descriptor, so the caller can tell "cancelled" (no-op) from "bad file" (alert).
export async function importTemplate(current: EditorState): Promise<EditorState | null> {
  const picked = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
  const asset = picked.canceled ? undefined : picked.assets[0];

  if (!asset) return null;

  const raw = await FileSystem.readAsStringAsync(asset.uri);
  const parsed = TemplateDescriptorSchema.safeParse(JSON.parse(raw));

  if (!parsed.success) throw new Error('Not a valid template descriptor');

  // The Zod-inferred shape and the core descriptor type are structurally identical here; cast so the
  // import reads meta/global (present on the core type) and feeds toEditorState's EditableTemplate.
  const descriptor = parsed.data as unknown as EditableTemplate['descriptor'];

  return toEditorState({
    id: current.id,
    name: descriptor.meta?.name ?? current.name,
    description: descriptor.meta?.description ?? current.description,
    orientation: descriptor.global?.orientation === 'portrait' ? 'portrait' : 'landscape',
    descriptor,
  });
}

export { previewRender } from './previewRender';
