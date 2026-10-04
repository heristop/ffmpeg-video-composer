// Stored drawtext positions that the builder's fraction model cannot express (absolute pixels,
// offsets from the frame edge) must survive an import and save unchanged, until the author moves
// the overlay, at which point the fraction form takes over.
import { describe, it, expect } from 'vitest';
import {
  buildDescriptor,
  toEditorState,
  makeTemplateId,
  type EditorSection,
  type TextOverlay,
} from '../src/editor/templateEditorModel';

function descriptorWith(x: string | number, y: string | number) {
  return {
    global: { orientation: 'landscape' },
    sections: [
      {
        name: 'intro',
        type: 'color_background',
        options: { backgroundColor: '#000000', duration: 3 },
        filters: [{ type: 'drawtext', values: { text: { en: 'Hello' }, fontfile: 'Rubik.ttf', x, y } }],
      },
    ],
  } as never;
}

function importOverlay(x: string | number, y: string | number): TextOverlay {
  const state = toEditorState({
    id: makeTemplateId(),
    name: 'Position test',
    description: '',
    orientation: 'landscape',
    descriptor: descriptorWith(x, y),
  });
  const section = state.sections.find((s: EditorSection) => s.kind === 'color') as Extract<
    EditorSection,
    { kind: 'color' }
  >;

  return section.overlays[0] as TextOverlay;
}

function savedPosition(overlay: TextOverlay) {
  const state = toEditorState({
    id: makeTemplateId(),
    name: 'Position test',
    description: '',
    orientation: 'landscape',
    descriptor: descriptorWith(0, 0),
  });
  const section = state.sections.find((s: EditorSection) => s.kind === 'color') as Extract<
    EditorSection,
    { kind: 'color' }
  >;
  section.overlays = [overlay];
  const built = buildDescriptor({ ...state, sections: [section] }) as {
    sections: { filters: { values: { x: unknown; y: unknown } }[] }[];
  };
  const values = built.sections[0].filters[0].values;

  return { x: values.x, y: values.y };
}

describe('overlay position round trip', () => {
  it('keeps an offset expression from the frame edge', () => {
    expect(savedPosition(importOverlay('w-text_w-44', 'h-text_h-44'))).toEqual({
      x: 'w-text_w-44',
      y: 'h-text_h-44',
    });
  });

  it('keeps an absolute pixel position', () => {
    expect(savedPosition(importOverlay(120, 385)).y).toBe(385);
  });

  it('falls back to the fraction form once the overlay is moved', () => {
    const moved = { ...importOverlay('w-text_w-44', 'h-text_h-44'), x: 0.25 };

    expect(savedPosition(moved).x).toBe('(w-text_w)*0.25');
  });

  it('keeps the canonical fraction form unchanged', () => {
    const canonical = importOverlay('(w-text_w)*0.25', '(h-text_h)*0.75');

    expect(savedPosition(canonical)).toEqual({ x: '(w-text_w)*0.25', y: '(h-text_h)*0.75' });
  });
});
