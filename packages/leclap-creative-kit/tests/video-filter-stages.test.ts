import { describe, expect, it } from 'vitest';
import {
  newOverlay,
  buildDescriptor,
  toEditorState,
  type EditableTemplate,
  type TemplateDescriptor,
  type EditorSection,
} from '../src/editor/templateEditorModel';
import promo from '../src/templates/web-app-promo.json';

function roundTrip(descriptor: TemplateDescriptor) {
  const template: EditableTemplate = {
    id: 'test',
    name: 'Test',
    description: '',
    orientation: 'landscape',
    descriptor,
  };
  return buildDescriptor(toEditorState(template)).sections?.find((section) => section.type === 'project_video');
}

describe('video filter stages', () => {
  it('retains the app promo perspective and framing chain when the editor saves it', () => {
    const input = promo as TemplateDescriptor;
    const clip = input.sections?.find((section) => section.type === 'project_video');
    const output = roundTrip(input);
    expect(output?.filters?.filter((filter) => filter.type !== 'drawtext')).toEqual(
      clip?.filters?.filter((filter) => filter.type !== 'drawtext')
    );
    expect(output?.options?.forceAspectRatio).toBe(false);
    expect(output?.filters?.find((filter) => filter.type === 'drawtext')?.values?.fontfile).toBe(
      clip?.filters?.find((filter) => filter.type === 'drawtext')?.values?.fontfile
    );
    expect(output?.filters?.at(-1)).toEqual({ type: 'scale', value: 'output' });
    expect(output?.filters?.findIndex((filter) => filter.type === 'drawtext')).toBeGreaterThan(
      output?.filters?.findIndex((filter) => filter.type === 'perspective') ?? -1
    );
  });

  it('preserves a filter between two editable overlays without moving it across the text', () => {
    const first = { type: 'drawtext', values: { text: { en: 'Before' }, x: '(w-text_w)*0.1', y: '(h-text_h)*0.1' } };
    const last = { type: 'drawtext', values: { text: { en: 'After' }, x: '(w-text_w)*0.8', y: '(h-text_h)*0.8' } };
    const filter = { type: 'rotate', value: '0.04' };
    const output = roundTrip({
      sections: [{ name: 'capture', type: 'project_video', options: { duration: 6 }, filters: [first, filter, last] }],
    });
    expect(output?.filters?.map((entry) => entry.type)).toEqual(['drawtext', 'rotate', 'drawtext']);
    expect(output?.filters?.[1]).toEqual(filter);
  });
  it('keeps the processing boundary before its surviving overlay when earlier text is deleted', () => {
    const descriptor: TemplateDescriptor = {
      sections: [
        {
          name: 'capture',
          type: 'project_video',
          options: { duration: 6 },
          filters: [
            { type: 'drawtext', values: { text: { en: 'Before' } } },
            { type: 'rotate', value: '0.04' },
            { type: 'drawtext', values: { text: { en: 'After' } } },
          ],
        },
      ],
    };
    const state = toEditorState({ id: 'test', name: 'Test', description: '', orientation: 'landscape', descriptor });
    const video = state.sections[0] as Extract<EditorSection, { kind: 'video' }>;
    video.overlays = video.overlays.filter((_, index) => index !== 0);
    const output = buildDescriptor(state).sections?.[0];
    expect(output?.filters?.map((entry) => entry.type)).toEqual(['rotate', 'drawtext']);
  });
  it('keeps frame processing ahead of newly inserted text', () => {
    const descriptor = promo as TemplateDescriptor;
    const state = toEditorState({ id: 'test', name: 'Test', description: '', orientation: 'landscape', descriptor });
    const video = state.sections.find((section) => section.kind === 'video') as Extract<
      EditorSection,
      { kind: 'video' }
    >;
    video.overlays.unshift({ ...newOverlay(), text: 'New text' });
    const output = buildDescriptor(state).sections?.find((section) => section.type === 'project_video');
    expect(output?.filters?.findIndex((filter) => filter.type === 'perspective')).toBeLessThan(
      output?.filters?.findIndex((filter) => filter.type === 'drawtext') ?? -1
    );
  });
});
