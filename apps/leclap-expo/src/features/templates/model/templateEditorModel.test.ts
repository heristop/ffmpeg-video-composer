import {
  buildDescriptor,
  newSection,
  toEditorState,
  DEFAULT_AUDIO_MIX,
  type EditorState,
  type EditableTemplate,
} from './templateEditorModel';
import { TemplateDescriptorSchema } from 'ffmpeg-video-composer/src/schemas/template.schemas.ts';
import htmlCard from '../../../../../../examples/motion-design/html-card.json';

// The editor model itself is exhaustively tested in the core package
// (packages/.../tests/template-editor-model.test.ts). This file only guards the expo re-export
// wiring: the shared module resolves through the expo import path and produces a valid descriptor.

const baseState = (over: Partial<EditorState> = {}): EditorState => ({
  id: 'user-test',
  name: 'My template',
  description: 'desc',
  orientation: 'landscape',
  sections: [newSection('video')],
  globalVariables: [],
  audio: { ...DEFAULT_AUDIO_MIX },
  defaultTransition: { type: 'cut', duration: 0.5 },
  globalOverlays: [],
  globalAnimations: [],
  ...over,
});

const asTemplate = (state: EditorState): EditableTemplate => ({
  id: state.id,
  name: state.name,
  description: state.description,
  orientation: state.orientation,
  descriptor: buildDescriptor(state),
});

describe('expo templateEditorModel re-export', () => {
  it('re-exports buildDescriptor producing a schema-valid descriptor', () => {
    const result = TemplateDescriptorSchema.safeParse(buildDescriptor(baseState()));

    expect(result.success).toBe(true);
  });

  it('round-trips the audio mix through the expo import path', () => {
    const state = baseState({ audio: { sourceVolume: 0.7, musicVolume: 0.3, ducking: false } });
    const back = toEditorState(asTemplate(state));

    expect(back.audio.sourceVolume).toBeCloseTo(0.7);
    expect(back.audio.musicVolume).toBeCloseTo(0.3);
  });

  it('toEditorState(null) returns DEFAULT_AUDIO_MIX and a single blank video section', () => {
    const state = toEditorState(null);

    expect(state.audio).toEqual(DEFAULT_AUDIO_MIX);
    expect(state.sections).toEqual([newSection('video')]);
  });

  it('keeps the HTML layers of an imported template, as the JSON import does (schema, then toEditorState)', () => {
    const parsed = TemplateDescriptorSchema.safeParse(htmlCard);

    expect(parsed.success).toBe(true);

    const descriptor = parsed.data as unknown as EditableTemplate['descriptor'];
    const state = toEditorState({
      id: 'user-html',
      name: 'html',
      description: '',
      orientation: 'landscape',
      descriptor,
    });
    const htmlInputs = (desc: unknown) => JSON.stringify(desc).match(/"type":"html"/g)?.length ?? 0;

    expect(htmlInputs(htmlCard)).toBeGreaterThan(0);
    expect(htmlInputs(buildDescriptor(state))).toBe(htmlInputs(htmlCard));
  });
});
