import { describe, it, expect } from 'vitest';
import {
  buildDescriptor,
  toEditorState,
  newSection,
  makeTemplateId,
  DEFAULT_AUDIO_MIX,
  DEFAULT_TRANSITION,
  type EditorState,
  type EditorSection,
  type SectionFit,
} from '../src/editor/templateEditorModel';

const stateWith = (sections: EditorSection[]): EditorState => ({
  id: makeTemplateId(),
  name: 'Fit test',
  description: '',
  orientation: 'landscape',
  sections,
  globalVariables: [],
  audio: { ...DEFAULT_AUDIO_MIX },
  defaultTransition: { ...DEFAULT_TRANSITION },
  globalAnimations: [],
  globalOverlays: [],
});

const video = (fit?: SectionFit): EditorSection => ({
  ...(newSection('video') as Extract<EditorSection, { kind: 'video' }>),
  ...(fit === undefined ? {} : { fit }),
});

const templateFrom = (state: EditorState) => ({
  id: state.id,
  name: state.name,
  description: state.description,
  orientation: state.orientation,
  descriptor: buildDescriptor(state),
});

describe('section fit (options.forceAspectRatio / forceOriginalAspectRatio)', () => {
  it('emits nothing for the default cover fit (unset or "cover")', () => {
    const unset = buildDescriptor(stateWith([video()])).sections?.[0]?.options;
    expect(unset).not.toHaveProperty('forceAspectRatio');
    expect(unset).not.toHaveProperty('forceOriginalAspectRatio');

    const cover = buildDescriptor(stateWith([video('cover')])).sections?.[0]?.options;
    expect(cover).not.toHaveProperty('forceAspectRatio');
    expect(cover).not.toHaveProperty('forceOriginalAspectRatio');
  });

  it('emits forceOriginalAspectRatio for letterbox', () => {
    const options = buildDescriptor(stateWith([video('letterbox')])).sections?.[0]?.options;
    expect(options?.forceOriginalAspectRatio).toBe(true);
    expect(options).not.toHaveProperty('forceAspectRatio');
  });

  it('emits forceAspectRatio: false for off', () => {
    const options = buildDescriptor(stateWith([video('off')])).sections?.[0]?.options;
    expect(options?.forceAspectRatio).toBe(false);
    expect(options).not.toHaveProperty('forceOriginalAspectRatio');
  });

  it('emits the fit on asset-backed clip sections too', () => {
    const clip: EditorSection = {
      ...(newSection('video') as Extract<EditorSection, { kind: 'video' }>),
      videoUrl: { source: 'library', id: 'bumper' },
      fit: 'letterbox',
    };
    const section = buildDescriptor(stateWith([clip])).sections?.[0];
    expect(section?.type).toBe('video');
    expect(section?.options?.forceOriginalAspectRatio).toBe(true);
  });

  it('round-trips through toEditorState for video and image sections', () => {
    const image: EditorSection = {
      ...(newSection('image') as Extract<EditorSection, { kind: 'image' }>),
      allowUpload: true,
      fit: 'off',
    };
    const back = toEditorState(templateFrom(stateWith([video('letterbox'), image])));

    const fits = back.sections.map((s) => ('fit' in s ? s.fit : undefined));
    expect(fits).toEqual(['letterbox', 'off']);
  });

  it('re-hydrates the default cover fit as an absent field', () => {
    const back = toEditorState(templateFrom(stateWith([video()])));
    expect(back.sections[0]).not.toHaveProperty('fit');
  });

  it('prefers letterbox when a stored descriptor sets both flags (engine precedence)', () => {
    const state = stateWith([video()]);
    const descriptor = buildDescriptor(state);
    descriptor.sections![0]!.options = {
      ...descriptor.sections![0]!.options,
      forceAspectRatio: false,
      forceOriginalAspectRatio: true,
    };

    const back = toEditorState({ id: 'x', name: 'n', description: '', orientation: 'landscape', descriptor });
    const first = back.sections[0] as Extract<EditorSection, { kind: 'video' }>;
    expect(first.fit).toBe('letterbox');
  });
});

describe('blur fit and footage edits', () => {
  const footage = {
    fill: { blur: 30, dim: 0.2 },
    focus: [
      { t: 0, x: 0.2, y: 0.5 },
      { t: 'beat:4', x: 0.8, y: 0.5, ease: 'ease-in-out' },
    ],
    clip: { from: 1, to: 4 },
    speedRamp: 'hero' as const,
    rampAudio: 'mute' as const,
    freeze: [{ at: 1.5, hold: 0.5, flash: true }],
  };

  it('emits fit: "blur" (no legacy flag spells it)', () => {
    const options = buildDescriptor(stateWith([video('blur')])).sections?.[0]?.options;
    expect(options?.fit).toBe('blur');
    expect(options).not.toHaveProperty('forceAspectRatio');
    expect(options).not.toHaveProperty('forceOriginalAspectRatio');
  });

  it('carries footage edits through a builder round trip unchanged', () => {
    const section: EditorSection = { ...video('blur'), footage } as EditorSection;
    const descriptor = buildDescriptor(stateWith([section]));

    expect(descriptor.sections?.[0]?.options).toMatchObject({ fit: 'blur', ...footage });

    const back = toEditorState(templateFrom(stateWith([section])));
    const first = back.sections[0] as Extract<EditorSection, { kind: 'video' }>;
    expect(first.fit).toBe('blur');
    expect(first.footage).toEqual(footage);
    expect(buildDescriptor({ ...stateWith(back.sections), id: 'x' }).sections?.[0]?.options).toEqual(
      descriptor.sections?.[0]?.options
    );
  });

  it('reads options.fit over the legacy flags and keeps an untouched section clean', () => {
    const descriptor = buildDescriptor(stateWith([video()]));
    descriptor.sections![0]!.options = { ...descriptor.sections![0]!.options, fit: 'off', forceAspectRatio: true };

    const back = toEditorState({ id: 'x', name: 'n', description: '', orientation: 'landscape', descriptor });
    expect((back.sections[0] as Extract<EditorSection, { kind: 'video' }>).fit).toBe('off');
    expect(toEditorState(templateFrom(stateWith([video()]))).sections[0]).not.toHaveProperty('footage');
  });
});
