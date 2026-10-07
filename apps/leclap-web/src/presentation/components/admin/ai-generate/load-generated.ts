// Turns a generated (or Jev-picked) descriptor into builder state. It always opens as a NEW draft —
// a fresh id — so saving it can never overwrite the template that was being edited; the shell then
// installs it through history.reset, which keeps the previous draft one Undo away.
import { OrientationSchema } from 'ffmpeg-video-composer/src/schemas/global.schemas.ts';
import type { SampleDetail } from 'ffmpeg-video-composer/src/samples/types.ts';
import {
  makeTemplateId,
  toEditorState,
  type EditorState,
  type Orientation,
  type TemplateDescriptor,
} from '../templateEditorModel';

function orientationOf(descriptor: TemplateDescriptor, fallback: Orientation): Orientation {
  const parsed = OrientationSchema.safeParse(descriptor.global?.orientation);

  return parsed.success ? parsed.data : fallback;
}

function metaString(descriptor: TemplateDescriptor, key: 'name' | 'description'): string {
  const value = (descriptor.meta as Record<string, unknown> | undefined)?.[key];

  return typeof value === 'string' ? value : '';
}

export function generatedToEditorState(descriptor: TemplateDescriptor, fallbackName: string): EditorState {
  return toEditorState({
    id: makeTemplateId(),
    name: metaString(descriptor, 'name') || fallbackName,
    description: metaString(descriptor, 'description'),
    orientation: orientationOf(descriptor, 'landscape'),
    descriptor,
  });
}

// A ready-made sample as a new draft; a chosen built-in theme is set on global.theme (copy untouched).
export function sampleToEditorState(sample: SampleDetail, theme?: string): EditorState {
  const descriptor = structuredClone(sample.template);

  if (theme) descriptor.global = { ...descriptor.global, theme };

  return generatedToEditorState(descriptor, sample.title);
}

// Replacing a draft that has edits asks first; an untouched (or freshly opened) one is replaced directly.
export function needsReplaceConfirmation(canUndo: boolean): boolean {
  return canUndo;
}
