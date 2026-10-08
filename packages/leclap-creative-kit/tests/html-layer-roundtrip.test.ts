// HTML layers (`inputs[]` of type "html") in the builder model: a section's html inputs open as editable
// layers and are written back with their name (maps reference it as @name), markup, box, placement, show
// window and motion, painted over the section's animations and images.
import { describe, it, expect } from 'vitest';
import {
  buildDescriptor,
  toEditorState,
  newSection,
  makeTemplateId,
  newHtmlLayer,
  DEFAULT_AUDIO_MIX,
  DEFAULT_TRANSITION,
  type EditorState,
  type EditorSection,
  type HtmlLayer,
} from '../src/editor/templateEditorModel';

const stateWith = (sections: EditorSection[]): EditorState => ({
  id: makeTemplateId(),
  name: 'Html layer test',
  description: '',
  orientation: 'landscape',
  sections,
  globalVariables: [],
  audio: { ...DEFAULT_AUDIO_MIX },
  defaultTransition: { ...DEFAULT_TRANSITION },
  globalAnimations: [],
  globalOverlays: [],
});

type ColorSection = Extract<EditorSection, { kind: 'color' }>;

const CARD: HtmlLayer = {
  id: 'address_card',
  name: 'address_card',
  html: '<div class="card"><p>{{ address }}</p></div>',
  css: '.card { padding: 24px; background: $color.surface }',
  width: 640,
  height: 240,
  position: '64:420',
  scale: '640:240',
  opacity: 0.9,
  start: 0.4,
  end: 2.4,
  motion: { type: 'rise', duration: 0.6 },
};

const colorWith = (extra: Partial<ColorSection>): EditorSection => ({
  ...(newSection('color') as ColorSection),
  ...extra,
});

describe('html layers in the builder model', () => {
  it('writes an html input with its name, box, placement, window and motion', () => {
    const descriptor = buildDescriptor(stateWith([colorWith({ htmlLayers: [CARD] })]));
    const inputs = descriptor.sections?.[0]?.inputs;

    expect(inputs).toEqual([
      {
        name: 'address_card',
        type: 'html',
        html: CARD.html,
        css: CARD.css,
        width: 640,
        height: 240,
        options: {
          position: '64:420',
          scale: '640:240',
          opacity: 0.9,
          start: 0.4,
          duration: 2,
          motion: { type: 'rise', duration: 0.6 },
        },
      },
    ]);
  });

  it('reopens the same layer, so a template round-trips unchanged', () => {
    const state = stateWith([colorWith({ htmlLayers: [CARD] })]);
    const descriptor = buildDescriptor(state);
    const reopened = toEditorState({
      id: state.id,
      name: state.name,
      description: '',
      orientation: 'landscape',
      descriptor,
    });

    expect((reopened.sections[0] as ColorSection).htmlLayers).toEqual([CARD]);
    expect(buildDescriptor(reopened).sections).toEqual(descriptor.sections);
  });

  it('paints html layers over images and animations, and names unnamed ones by position', () => {
    const descriptor = buildDescriptor(
      stateWith([
        colorWith({
          animations: [{ id: 'a', url: '/assets/animations/confetti.apng' }],
          htmlLayers: [{ ...newHtmlLayer(), id: 'x', name: undefined }],
        }),
      ])
    );

    expect(descriptor.sections?.[0]?.inputs?.map((input) => [input.name, input.type])).toEqual([
      ['animation_0', 'animation'],
      ['html_0', 'html'],
    ]);
  });

  it('starts a new layer as a visible card with a box and its css', () => {
    const layer = newHtmlLayer();

    expect(layer.html).toContain('<');
    expect(layer.css).toBeTruthy();
    expect(layer.width).toBeGreaterThan(0);
    expect(layer.height).toBeGreaterThan(0);
  });
});
