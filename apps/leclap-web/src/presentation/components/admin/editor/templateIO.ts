// Pure JSON import/export for the builder. Export serialises the built descriptor; import parses
// arbitrary JSON, validates it with the core validator (field-aware: a `{{ HOLD }}` placeholder in a numeric
// slot is checked as the typed value it renders as), and (on success) re-hydrates an EditorState
// — round-tripping cleanly because buildDescriptor / toEditorState are inverse. No DOM dependency
// (the actual file download/upload wiring lives in the component); unit-testable in node.
import { OrientationSchema } from 'ffmpeg-video-composer/src/schemas/global.schemas.ts';
import { BaseTemplateValidator } from 'ffmpeg-video-composer/src/services/BaseTemplateValidator.ts';
import {
  buildDescriptor,
  toEditorState,
  type EditorState,
  type Orientation,
  type TemplateDescriptor,
} from '../templateEditorModel';

export interface ImportSuccess {
  ok: true;
  state: EditorState;
}

export interface ImportFailure {
  ok: false;
  // Human-readable lines like "sections.0.type: Invalid enum value" for the error dialog.
  errors: string[];
}

export type ImportResult = ImportSuccess | ImportFailure;

// Pretty-printed descriptor JSON for download.
export function exportDescriptorJson(state: EditorState): string {
  return JSON.stringify(buildDescriptor(state), null, 2);
}

// A filesystem-safe filename derived from the template name (falls back to "template").
export function exportFilename(state: EditorState): string {
  const base = state.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `${base === '' ? 'template' : base}.json`;
}

// Validator findings as readable "path: message" lines for the import-failure dialog.
function readableErrors(errors: Array<{ path: string; message: string }>): string[] {
  return errors.map((error) => `${error.path === '' ? 'root' : error.path}: ${error.message}`);
}

// Every OrientationSchema value (landscape/portrait/square) maps through; only an absent or
// unrecognised orientation keeps the editor's current one. TemplateDescriptor types the field as a
// plain string, so this narrows it back to the enum the editor state requires.
function importedOrientation(value: string | undefined, current: Orientation): Orientation {
  const parsed = OrientationSchema.safeParse(value);

  if (!parsed.success) return current;

  return parsed.data;
}

// Parse + validate raw JSON text into an EditorState. The current id carries over so the import
// lands as an undoable edit of the same template (not a brand-new one), but the imported
// descriptor's own identity wins: toEditorState prefers descriptor.meta name/description over the
// wrapper values passed here (which remain the per-field fallback for meta-less legacy JSON).
// On any failure the validator's findings are surfaced verbatim. The descriptor kept is the JSON as written
// (placeholders, partial refs and `global.fields` included), never the probe-filled copy the check read.
export function importDescriptorJson(text: string, current: EditorState): ImportResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [`Invalid JSON: ${error instanceof Error ? error.message : 'parse error'}`] };
  }

  const result = new BaseTemplateValidator().validateTemplate(parsed);

  if (!result.success) {
    return { ok: false, errors: readableErrors(result.errors ?? []) };
  }

  const descriptor = parsed as TemplateDescriptor;

  // Effect sections have no builder representation yet. Importing them would silently turn the effect
  // into a camera or upload slot with no effect id, props or assets, so refuse and point at the JSON.
  if (descriptor.sections?.some((section) => section.type === 'effect')) {
    return {
      ok: false,
      errors: ['Effect sections cannot be edited in the builder yet. Edit this template as JSON instead.'],
    };
  }

  const state = toEditorState({
    id: current.id,
    name: current.name,
    description: current.description,
    orientation: importedOrientation(descriptor.global?.orientation, current.orientation),
    descriptor,
  });

  return { ok: true, state };
}
