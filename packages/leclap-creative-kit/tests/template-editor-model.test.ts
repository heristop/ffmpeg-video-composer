import { describe, it, expect } from 'vitest';
import {
  buildDescriptor,
  collectVariables,
  newOverlay,
  newSection,
  parseFraction,
  toEditorState,
  duplicateSection,
  setTransitionAfter,
  patchLayers,
  createHistory,
  DEFAULT_AUDIO_MIX,
  DEFAULT_TRANSITION,
  type EditorState,
  type EditorSection,
  type EditableTemplate,
  type TemplateDescriptor,
  type TextOverlay,
  type BackgroundLayer,
} from '../src/editor/templateEditorModel';
import { TemplateDescriptorSchema } from 'ffmpeg-video-composer/src/schemas/template.schemas.ts';

// Id-agnostic literals — the model never resolves them, so we avoid app media catalogs.
const music1 = 'point-being';
const music2 = 'lofi-cafe';
const bg1 = 'forest-sea';
const bg2 = 'golden-hour';

function baseState(input: EditorSection[] | Partial<EditorState> = {}): EditorState {
  const over: Partial<EditorState> = Array.isArray(input) ? { sections: input } : input;

  const defaults: EditorState = {
    id: 'user-1',
    name: 'T',
    description: '',
    orientation: 'landscape',
    sections: [],
    globalVariables: [],
    audio: { ...DEFAULT_AUDIO_MIX },
    defaultTransition: { ...DEFAULT_TRANSITION },
    globalAnimations: [],
    globalOverlays: [],
  };

  return { ...defaults, ...over };
}

function asTemplate(state: EditorState): EditableTemplate {
  return {
    id: state.id,
    name: state.name,
    description: state.description,
    orientation: state.orientation,
    descriptor: buildDescriptor(state),
  };
}

function overlay(over: Partial<TextOverlay> = {}): TextOverlay {
  return { ...newOverlay(), ...over };
}

function videoSection(overlays: TextOverlay[]): EditorSection {
  return { ...(newSection('video') as Extract<EditorSection, { kind: 'video' }>), overlays };
}

function drawtextFilters(state: EditorState): Array<Record<string, unknown>> {
  const d = buildDescriptor(state);
  const video = d.sections?.find((s) => s.type === 'project_video');

  return (video?.filters ?? []).filter((f) => f.type === 'drawtext').map((f) => f.values as Record<string, unknown>);
}

function drawtextValues(state: EditorState): Record<string, unknown> | undefined {
  return drawtextFilters(state)[0];
}

// --- newSection / newOverlay defaults ---

describe('templateEditorModel — newSection/newOverlay defaults', () => {
  it('creates sensible defaults per kind', () => {
    expect(newSection('video')).toEqual({
      kind: 'video',
      duration: 8,
      mute: false,
      overlays: [],
      countdown: false,
      countdownSeconds: 4,
    });
    expect(newSection('color')).toEqual({ kind: 'color', duration: 3, color: '#7C83FD', overlays: [] });
    expect(newSection('form')).toEqual({
      kind: 'form',
      fields: [{ name: 'field_1', label: 'Label', maxLength: 40 }],
    });
    expect(newSection('music')).toEqual({ kind: 'music', allowed: [], allowUpload: false });
    expect(newSection('image')).toEqual({ kind: 'image', allowed: [], allowUpload: false, duration: 4, overlays: [] });
    expect(newSection('partial')).toEqual({ kind: 'partial', ref: '', variables: [] });
  });

  it('newOverlay() is a centered, white, box-less overlay on the default font', () => {
    expect(newOverlay()).toEqual({
      text: '',
      x: 0.5,
      y: 0.5,
      fontsize: 48,
      fontcolor: '#ffffff',
      font: 'rubik',
      box: false,
      boxcolor: '#000000',
      boxOpacity: 0.5,
    });
  });
});

// --- animation overlay ---

describe('templateEditorModel — animation overlay', () => {
  const colorWithAnimation = (animation: {
    url: string;
    position?: string;
    scale?: string;
    fit?: 'stretch' | 'contain' | 'cover';
    loop?: boolean;
    persistent?: boolean;
    opacity?: number;
    rotation?: number;
  }): EditorSection => ({
    ...(newSection('color') as Extract<EditorSection, { kind: 'color' }>),
    animations: [{ id: 'a', label: 'Border', ...animation }],
  });

  it('emits one looping, persistent animation input and stays schema-valid', () => {
    const d = buildDescriptor(baseState([colorWithAnimation({ url: '/assets/animations/rounded_border.apng' })]));
    const section = d.sections?.find((s) => s.inputs);

    expect(section?.inputs).toEqual([
      {
        name: 'animation_0',
        url: '/assets/animations/rounded_border.apng',
        type: 'animation',
        options: { loop: true, persistent: true },
      },
    ]);
    expect(() => TemplateDescriptorSchema.parse(d)).not.toThrow();
  });

  it('passes position/scale through the input options', () => {
    const d = buildDescriptor(
      baseState([
        colorWithAnimation({ url: '/assets/animations/animation_icons.apng', position: '40:40', scale: '160:-1' }),
      ])
    );
    const input = d.sections?.find((s) => s.inputs)?.inputs?.[0];

    expect(input?.options).toEqual({ loop: true, persistent: true, position: '40:40', scale: '160:-1' });
  });

  it('passes explicit loop / keep-last-frame choices through the input options', () => {
    const d = buildDescriptor(
      baseState([colorWithAnimation({ url: '/assets/animations/shine_sweep.apng', loop: true, persistent: false })])
    );
    const input = d.sections?.find((s) => s.inputs)?.inputs?.[0];

    expect(input?.options).toEqual({ loop: true, persistent: false });
  });

  it('round-trips a non-default loop / keep-last-frame back into the editor', () => {
    const state = baseState([
      colorWithAnimation({ url: '/assets/animations/corner_brackets.apng', loop: false, persistent: true }),
    ]);
    const back = toEditorState(asTemplate(state));
    const color = back.sections.find((s) => s.kind === 'color') as Extract<EditorSection, { kind: 'color' }>;

    // Only the non-default (loop:false) is carried; persistent:true is the default and is omitted.
    // The label is lost across the descriptor; the id is recovered from the input name.
    expect(color.animations).toEqual([
      { id: 'animation_0', url: '/assets/animations/corner_brackets.apng', loop: false },
    ]);
  });

  it('round-trips url + position + scale back into the editor', () => {
    const state = baseState([
      colorWithAnimation({ url: '/assets/animations/white_border.apng', position: '0:10', scale: '720:-1' }),
    ]);
    const back = toEditorState(asTemplate(state));
    const color = back.sections.find((s) => s.kind === 'color') as Extract<EditorSection, { kind: 'color' }>;

    expect(color.animations).toEqual([
      { id: 'animation_0', url: '/assets/animations/white_border.apng', position: '0:10', scale: '720:-1' },
    ]);
  });

  it('passes a faded opacity through the input options', () => {
    const d = buildDescriptor(
      baseState([colorWithAnimation({ url: '/assets/animations/light_leak.apng', opacity: 0.4 })])
    );
    const input = d.sections?.find((s) => s.inputs)?.inputs?.[0];

    expect(input?.options).toEqual({ loop: true, persistent: true, opacity: 0.4 });
    expect(() => TemplateDescriptorSchema.parse(d)).not.toThrow();
  });

  it('omits opacity from the input options when fully opaque', () => {
    const d = buildDescriptor(
      baseState([colorWithAnimation({ url: '/assets/animations/light_leak.apng', opacity: 1 })])
    );
    const input = d.sections?.find((s) => s.inputs)?.inputs?.[0];

    expect(input?.options).toEqual({ loop: true, persistent: true });
  });

  it('round-trips a faded opacity back into the editor', () => {
    const state = baseState([colorWithAnimation({ url: '/assets/animations/light_leak.apng', opacity: 0.4 })]);
    const back = toEditorState(asTemplate(state));
    const color = back.sections.find((s) => s.kind === 'color') as Extract<EditorSection, { kind: 'color' }>;

    expect(color.animations).toEqual([{ id: 'animation_0', url: '/assets/animations/light_leak.apng', opacity: 0.4 }]);
  });

  it('passes a nonzero rotation through the input options', () => {
    const d = buildDescriptor(baseState([colorWithAnimation({ url: '/assets/animations/badge.apng', rotation: 30 })]));
    const input = d.sections?.find((s) => s.inputs)?.inputs?.[0];

    expect(input?.options).toEqual({ loop: true, persistent: true, rotation: 30 });
    expect(() => TemplateDescriptorSchema.parse(d)).not.toThrow();
  });

  it('omits rotation from the input options when upright (0)', () => {
    const d = buildDescriptor(baseState([colorWithAnimation({ url: '/assets/animations/badge.apng', rotation: 0 })]));
    const input = d.sections?.find((s) => s.inputs)?.inputs?.[0];

    expect(input?.options).toEqual({ loop: true, persistent: true });
  });

  it('round-trips a rotation back into the editor', () => {
    const state = baseState([colorWithAnimation({ url: '/assets/animations/badge.apng', rotation: 30 })]);
    const back = toEditorState(asTemplate(state));
    const color = back.sections.find((s) => s.kind === 'color') as Extract<EditorSection, { kind: 'color' }>;

    expect(color.animations).toEqual([{ id: 'animation_0', url: '/assets/animations/badge.apng', rotation: 30 }]);
  });

  it('passes a contain/cover fit through the input options and stays schema-valid', () => {
    const d = buildDescriptor(
      baseState([colorWithAnimation({ url: '/assets/animations/badge.apng', scale: '200:200', fit: 'contain' })])
    );
    const input = d.sections?.find((s) => s.inputs)?.inputs?.[0];

    expect(input?.options).toEqual({ loop: true, persistent: true, scale: '200:200', fit: 'contain' });
    expect(() => TemplateDescriptorSchema.parse(d)).not.toThrow();
  });

  it('omits the fit from the input options when stretch (the default)', () => {
    const d = buildDescriptor(
      baseState([colorWithAnimation({ url: '/assets/animations/badge.apng', scale: '200:200', fit: 'stretch' })])
    );
    const input = d.sections?.find((s) => s.inputs)?.inputs?.[0];

    expect(input?.options).toEqual({ loop: true, persistent: true, scale: '200:200' });
  });

  it('round-trips a fit back into the editor', () => {
    const state = baseState([
      colorWithAnimation({ url: '/assets/animations/badge.apng', scale: '200:200', fit: 'cover' }),
    ]);
    const back = toEditorState(asTemplate(state));
    const color = back.sections.find((s) => s.kind === 'color') as Extract<EditorSection, { kind: 'color' }>;

    expect(color.animations).toEqual([
      { id: 'animation_0', url: '/assets/animations/badge.apng', scale: '200:200', fit: 'cover' },
    ]);
  });

  it('emits no inputs when a visual section has no animation', () => {
    const d = buildDescriptor(baseState([newSection('color')]));

    expect(d.sections?.every((s) => s.inputs === undefined)).toBe(true);
  });
});

// --- ffmpeg-feature sugar: text effect, chroma key, overlay motion ---

describe('templateEditorModel — ffmpeg-feature sugar round-trips', () => {
  type VideoSection = Extract<EditorSection, { kind: 'video' }>;
  type ColorSection = Extract<EditorSection, { kind: 'color' }>;
  const video = (over: Partial<VideoSection>): EditorSection => ({
    ...(newSection('video') as VideoSection),
    ...over,
  });

  it('emits and round-trips a caption text effect (shadow + outline)', () => {
    const state = baseState([video({ caption: { text: 'Hi', effect: { shadow: true, outline: { width: 3 } } } })]);
    const d = buildDescriptor(state);
    const section = d.sections?.find((s) => s.caption);

    expect(section?.caption?.effect).toEqual({ shadow: true, outline: { width: 3 } });
    expect(() => TemplateDescriptorSchema.parse(d)).not.toThrow();

    const back = toEditorState(asTemplate(state));
    const recovered = back.sections.find((s) => s.kind === 'video') as VideoSection;
    expect(recovered.caption?.effect).toEqual({ shadow: true, outline: { width: 3 } });
  });

  it('emits and round-trips a video chroma key', () => {
    const chromaKey = { color: '#00FF00', similarity: 0.25, blend: 0.05, background: '#10243f' };
    const state = baseState([video({ chromaKey })]);
    const d = buildDescriptor(state);
    const section = d.sections?.find((s) => (s as { chromaKey?: unknown }).chromaKey) as
      | { chromaKey?: unknown }
      | undefined;

    expect(section?.chromaKey).toEqual(chromaKey);
    expect(() => TemplateDescriptorSchema.parse(d)).not.toThrow();

    const back = toEditorState(asTemplate(state));
    const recovered = back.sections.find((s) => s.kind === 'video') as VideoSection;
    expect(recovered.chromaKey).toEqual(chromaKey);
  });

  it('emits and round-trips a cinemascope letterbox on a video section', () => {
    const letterbox = { aspect: 2.39, color: '#111111' };
    const state = baseState([video({ letterbox })]);
    const d = buildDescriptor(state);
    const section = d.sections?.find((s) => (s as { letterbox?: unknown }).letterbox) as
      | { letterbox?: unknown }
      | undefined;

    expect(section?.letterbox).toEqual(letterbox);
    expect(() => TemplateDescriptorSchema.parse(d)).not.toThrow();

    const back = toEditorState(asTemplate(state));
    const recovered = back.sections.find((s) => s.kind === 'video') as VideoSection;
    expect(recovered.letterbox).toEqual(letterbox);
  });

  it('emits and round-trips a letterbox on a color section', () => {
    const letterbox = { aspect: 1.85 };
    const color: EditorSection = { ...(newSection('color') as ColorSection), letterbox };
    const d = buildDescriptor(baseState([color]));
    const section = d.sections?.find((s) => s.type === 'color_background') as { letterbox?: unknown } | undefined;

    expect(section?.letterbox).toEqual(letterbox);
    expect(() => TemplateDescriptorSchema.parse(d)).not.toThrow();

    const back = toEditorState(asTemplate(baseState([color])));
    const recovered = back.sections.find((s) => s.kind === 'color') as ColorSection;
    expect(recovered.letterbox).toEqual(letterbox);
  });

  it('emits no letterbox field when unset', () => {
    const d = buildDescriptor(baseState([video({})]));

    expect(d.sections?.find((s) => s.type === 'project_video')).not.toHaveProperty('letterbox');
  });

  it('emits and round-trips a section audioEffect', () => {
    const state = baseState([video({ audioEffect: 'telephone' })]);
    const d = buildDescriptor(state);
    const section = d.sections?.find((s) => s.type === 'project_video');

    expect(section?.options?.audioEffect).toBe('telephone');
    expect(() => TemplateDescriptorSchema.parse(d)).not.toThrow();

    const back = toEditorState(asTemplate(state));
    const recovered = back.sections.find((s) => s.kind === 'video') as VideoSection;
    expect(recovered.audioEffect).toBe('telephone');
  });

  it('emits no audioEffect option when unset', () => {
    const d = buildDescriptor(baseState([video({})]));

    expect(d.sections?.find((s) => s.type === 'project_video')?.options).not.toHaveProperty('audioEffect');
  });

  it('emits and round-trips shake/pulse motion effects (new MotionEffect union members)', () => {
    const shakeState = baseState([video({ motion: [{ type: 'shake', intensity: 10, frequency: 3 }] })]);
    const shakeDescriptor = buildDescriptor(shakeState);

    expect(shakeDescriptor.sections?.find((s) => s.type === 'project_video')?.motion).toEqual([
      { type: 'shake', intensity: 10, frequency: 3 },
    ]);
    expect(() => TemplateDescriptorSchema.parse(shakeDescriptor)).not.toThrow();

    const shakeBack = toEditorState(asTemplate(shakeState));
    const shakeRecovered = shakeBack.sections.find((s) => s.kind === 'video') as VideoSection;
    expect(shakeRecovered.motion).toEqual([{ type: 'shake', intensity: 10, frequency: 3 }]);

    const pulseState = baseState([video({ motion: [{ type: 'pulse', intensity: 1.15, frequency: 0.5 }] })]);
    const pulseDescriptor = buildDescriptor(pulseState);

    expect(pulseDescriptor.sections?.find((s) => s.type === 'project_video')?.motion).toEqual([
      { type: 'pulse', intensity: 1.15, frequency: 0.5 },
    ]);
    expect(() => TemplateDescriptorSchema.parse(pulseDescriptor)).not.toThrow();
  });

  it('emits and round-trips grade.grain (new GradeSchema field)', () => {
    const state = baseState([video({ grade: { grain: 0.4 } })]);
    const d = buildDescriptor(state);

    expect(d.sections?.find((s) => s.type === 'project_video')?.grade).toEqual({ grain: 0.4 });
    expect(() => TemplateDescriptorSchema.parse(d)).not.toThrow();

    const back = toEditorState(asTemplate(state));
    const recovered = back.sections.find((s) => s.kind === 'video') as VideoSection;
    expect(recovered.grade).toEqual({ grain: 0.4 });
  });

  it('emits and round-trips an animation overlay motion', () => {
    const color: EditorSection = {
      ...(newSection('color') as ColorSection),
      animations: [{ id: 'a', url: '/assets/animations/pulse_ring.apng', motion: 'slide-left' }],
    };
    const d = buildDescriptor(baseState([color]));
    const input = d.sections?.find((s) => s.inputs)?.inputs?.[0];

    expect(input?.options).toMatchObject({ motion: 'slide-left' });
    expect(() => TemplateDescriptorSchema.parse(d)).not.toThrow();

    const back = toEditorState(asTemplate(baseState([color])));
    const recovered = back.sections.find((s) => s.kind === 'color') as ColorSection;
    expect(recovered.animations?.[0]).toMatchObject({ motion: 'slide-left' });
  });

  it('emits and round-trips an overlay motion with an easing curve', () => {
    const motion = { type: 'rise' as const, easing: 'ease-out' as const };
    const color: EditorSection = {
      ...(newSection('color') as ColorSection),
      animations: [{ id: 'a', url: '/assets/animations/pulse_ring.apng', motion }],
    };
    const d = buildDescriptor(baseState([color]));
    const input = d.sections?.find((s) => s.inputs)?.inputs?.[0];

    expect(input?.options).toMatchObject({ motion });
    expect(() => TemplateDescriptorSchema.parse(d)).not.toThrow();

    const back = toEditorState(asTemplate(baseState([color])));
    const recovered = back.sections.find((s) => s.kind === 'color') as ColorSection;
    expect(recovered.animations?.[0]).toMatchObject({ motion });
  });

  it('emits and round-trips a caption reveal with an easing curve', () => {
    const reveal = { type: 'slide-left' as const, easing: 'ease-in-out' as const };
    const state = baseState([video({ caption: { text: 'Hi', reveal } })]);
    const d = buildDescriptor(state);

    expect(d.sections?.find((s) => s.caption)?.caption?.reveal).toEqual(reveal);
    expect(() => TemplateDescriptorSchema.parse(d)).not.toThrow();

    const back = toEditorState(asTemplate(state));
    const recovered = back.sections.find((s) => s.kind === 'video') as VideoSection;
    expect(recovered.caption?.reveal).toEqual(reveal);
  });

  it('emits and round-trips a positionable text overlay effect (shadow + outline)', () => {
    const state = baseState([
      videoSection([overlay({ text: 'Hi', effect: { shadow: true, outline: { color: '#ff0000' } } })]),
    ]);
    const values = drawtextValues(state);

    // Exact engine defaults from applyTextEffect (editor/presets/text.ts) — catches drift with the
    // kit-side mirror in overlayFilters.ts.
    expect(values).toMatchObject({
      shadowcolor: '#000000@0.6',
      shadowx: 2,
      shadowy: 2,
      bordercolor: '#ff0000',
      borderw: 2,
    });
    expect(() => TemplateDescriptorSchema.parse(buildDescriptor(state))).not.toThrow();

    const back = toEditorState(asTemplate(state));
    const recovered = back.sections.find((s) => s.kind === 'video') as VideoSection;
    expect(recovered.overlays[0].effect).toEqual({ shadow: true, outline: { color: '#ff0000' } });
  });

  it('emits no shadow/border keys and recovers no effect when the overlay has none', () => {
    const state = baseState([videoSection([overlay({ text: 'Hi' })])]);
    const values = drawtextValues(state);

    expect(values).not.toHaveProperty('shadowcolor');
    expect(values).not.toHaveProperty('bordercolor');

    const back = toEditorState(asTemplate(state));
    const recovered = back.sections.find((s) => s.kind === 'video') as VideoSection;
    expect(recovered.overlays[0].effect).toBeUndefined();
  });

  it('recovers a customised overlay shadow as an object with only the overridden fields', () => {
    const state = baseState([videoSection([overlay({ text: 'Hi', effect: { shadow: { dx: 6, dy: 6 } } })])]);

    const back = toEditorState(asTemplate(state));
    const recovered = back.sections.find((s) => s.kind === 'video') as VideoSection;
    expect(recovered.overlays[0].effect).toEqual({ shadow: { dx: 6, dy: 6 } });
  });

  it('emits a title card effect on a color section', () => {
    const color: EditorSection = {
      ...(newSection('color') as ColorSection),
      titleCard: { headline: { en: 'Hi' }, effect: { shadow: true, outline: true } },
    };
    const d = buildDescriptor(baseState([color]));
    const section = d.sections?.find((s) => (s as { titleCard?: unknown }).titleCard) as
      | { titleCard?: { effect?: unknown } }
      | undefined;

    expect(section?.titleCard?.effect).toEqual({ shadow: true, outline: true });
    expect(() => TemplateDescriptorSchema.parse(d)).not.toThrow();
  });
});

// --- image overlays on color / image sections ---

describe('templateEditorModel — image overlays on color/image sections', () => {
  const colorWithImage = (): EditorSection => ({
    ...(newSection('color') as Extract<EditorSection, { kind: 'color' }>),
    images: [{ id: 'i', choice: { source: 'url', url: '/logo.png' }, position: '20:20' }],
  });

  const imageWithImage = (): EditorSection => ({
    ...(newSection('image') as Extract<EditorSection, { kind: 'image' }>),
    images: [{ id: 'i', choice: { source: 'url', url: '/logo.png' } }],
  });

  it('composites an image overlay on a color section as a type:image input', () => {
    const d = buildDescriptor(baseState([colorWithImage()]));
    const section = d.sections?.find((s) => s.type === 'color_background');

    expect(section?.inputs).toEqual([
      { name: 'image_0', url: '/logo.png', type: 'image', options: { position: '20:20' } },
    ]);
    expect(() => TemplateDescriptorSchema.parse(d)).not.toThrow();
  });

  it('composites an image overlay on an image section as a type:image input', () => {
    const d = buildDescriptor(baseState([imageWithImage()]));
    const section = d.sections?.find((s) => s.type === 'image_background');

    expect(section?.inputs).toEqual([{ name: 'image_0', url: '/logo.png', type: 'image', options: {} }]);
    expect(() => TemplateDescriptorSchema.parse(d)).not.toThrow();
  });

  it('keeps animations alongside image overlays on a color section, animations first', () => {
    const section: EditorSection = {
      ...(newSection('color') as Extract<EditorSection, { kind: 'color' }>),
      animations: [{ id: 'a', url: '/border.apng' }],
      images: [{ id: 'i', choice: { source: 'url', url: '/logo.png' } }],
    };
    const d = buildDescriptor(baseState([section]));
    const inputs = d.sections?.find((s) => s.type === 'color_background')?.inputs;

    expect(inputs?.map((i) => i.type)).toEqual(['animation', 'image']);
    expect(() => TemplateDescriptorSchema.parse(d)).not.toThrow();
  });

  it('round-trips a color-section image overlay back into the editor', () => {
    const back = toEditorState(asTemplate(baseState([colorWithImage()])));
    const color = back.sections.find((s) => s.kind === 'color') as Extract<EditorSection, { kind: 'color' }>;

    expect(color.images).toEqual([{ id: 'image_0', choice: { source: 'url', url: '/logo.png' }, position: '20:20' }]);
  });

  it('emits and round-trips an image overlay fit; stretch stays omitted', () => {
    const section: EditorSection = {
      ...(newSection('color') as Extract<EditorSection, { kind: 'color' }>),
      images: [
        { id: 'a', choice: { source: 'url', url: '/logo.png' }, scale: '200:200', fit: 'contain' },
        { id: 'b', choice: { source: 'url', url: '/sticker.png' }, scale: '120:120', fit: 'stretch' },
      ],
    };
    const state = baseState([section]);
    const inputs = buildDescriptor(state).sections?.find((s) => s.inputs)?.inputs;

    expect(inputs?.[0].options).toEqual({ scale: '200:200', fit: 'contain' });
    expect(inputs?.[1].options).toEqual({ scale: '120:120' });
    expect(() => TemplateDescriptorSchema.parse(buildDescriptor(state))).not.toThrow();

    const back = toEditorState(asTemplate(state));
    const color = back.sections.find((s) => s.kind === 'color') as Extract<EditorSection, { kind: 'color' }>;

    expect(color.images).toEqual([
      { id: 'image_0', choice: { source: 'url', url: '/logo.png' }, scale: '200:200', fit: 'contain' },
      { id: 'image_1', choice: { source: 'url', url: '/sticker.png' }, scale: '120:120' },
    ]);
  });

  it('emits an image overlay show window (start/end) as input start/duration', () => {
    const section: EditorSection = {
      ...(newSection('color') as Extract<EditorSection, { kind: 'color' }>),
      images: [{ id: 'i', choice: { source: 'url', url: '/logo.png' }, start: 2, end: 5 }],
    };
    const d = buildDescriptor(baseState([section]));
    const input = d.sections?.find((s) => s.inputs)?.inputs?.[0];

    expect(input?.options).toEqual({ start: 2, duration: 3 });
    expect(() => TemplateDescriptorSchema.parse(d)).not.toThrow();
  });

  it('emits only duration when the image window starts at 0, and only start when it has no end', () => {
    const section: EditorSection = {
      ...(newSection('color') as Extract<EditorSection, { kind: 'color' }>),
      images: [
        { id: 'a', choice: { source: 'url', url: '/a.png' }, end: 4 },
        { id: 'b', choice: { source: 'url', url: '/b.png' }, start: 1.5 },
      ],
    };
    const inputs = buildDescriptor(baseState([section])).sections?.find((s) => s.inputs)?.inputs;

    expect(inputs?.[0].options).toEqual({ duration: 4 });
    expect(inputs?.[1].options).toEqual({ start: 1.5 });
  });

  it('does not emit timing when end is not after start (a collapsed window means untimed)', () => {
    const section: EditorSection = {
      ...(newSection('color') as Extract<EditorSection, { kind: 'color' }>),
      images: [{ id: 'i', choice: { source: 'url', url: '/logo.png' }, start: 3, end: 3 }],
    };
    const input = buildDescriptor(baseState([section])).sections?.find((s) => s.inputs)?.inputs?.[0];

    expect(input?.options).toEqual({ start: 3 });
  });

  it('round-trips an image overlay show window back into start/end', () => {
    const section: EditorSection = {
      ...(newSection('color') as Extract<EditorSection, { kind: 'color' }>),
      images: [{ id: 'i', choice: { source: 'url', url: '/logo.png' }, start: 0.1, end: 0.3 }],
    };
    const back = toEditorState(asTemplate(baseState([section])));
    const color = back.sections.find((s) => s.kind === 'color') as Extract<EditorSection, { kind: 'color' }>;

    // end rehydrates as start + duration with float noise trimmed (0.1 + 0.2 must give 0.3, not 0.30000000000000004)
    expect(color.images?.[0]).toMatchObject({ start: 0.1, end: 0.3 });
  });

  it('emits a shape overlay as a type:image input carrying the shape recipe', () => {
    const section: EditorSection = {
      ...(newSection('color') as Extract<EditorSection, { kind: 'color' }>),
      images: [
        {
          id: 's',
          choice: { source: 'url', url: 'data:image/png;base64,AAAA' },
          scale: '480:480',
          shape: { kind: 'rect', color: '#ff4d4d', cornerRadius: 24, strokeWidth: 4, strokeColor: '#ffffff' },
        },
      ],
    };
    const d = buildDescriptor(baseState([section]));
    const input = d.sections?.find((s) => s.inputs)?.inputs?.[0];

    expect(input).toEqual({
      name: 'image_0',
      url: 'data:image/png;base64,AAAA',
      type: 'image',
      shape: { kind: 'rect', color: '#ff4d4d', cornerRadius: 24, strokeWidth: 4, strokeColor: '#ffffff' },
      options: { scale: '480:480' },
    });
    expect(() => TemplateDescriptorSchema.parse(d)).not.toThrow();
  });

  it('round-trips a shape overlay back into the editor with its recipe intact', () => {
    const section: EditorSection = {
      ...(newSection('color') as Extract<EditorSection, { kind: 'color' }>),
      images: [
        {
          id: 's',
          choice: { source: 'url', url: 'data:image/png;base64,AAAA' },
          position: '120:80',
          scale: '300:300',
          shape: { kind: 'ellipse', color: '#7c83fd' },
        },
      ],
    };
    const back = toEditorState(asTemplate(baseState([section])));
    const color = back.sections.find((s) => s.kind === 'color') as Extract<EditorSection, { kind: 'color' }>;

    expect(color.images).toEqual([
      {
        id: 'image_0',
        choice: { source: 'url', url: 'data:image/png;base64,AAAA' },
        position: '120:80',
        scale: '300:300',
        shape: { kind: 'ellipse', color: '#7c83fd' },
      },
    ]);
  });

  it('keeps a plain data:-url image a plain image on import (no shape field, no recipe)', () => {
    const section: EditorSection = {
      ...(newSection('color') as Extract<EditorSection, { kind: 'color' }>),
      images: [{ id: 'i', choice: { source: 'url', url: 'data:image/png;base64,BBBB' } }],
    };
    const input = buildDescriptor(baseState([section])).sections?.find((s) => s.inputs)?.inputs?.[0];
    expect(input).not.toHaveProperty('shape');

    const back = toEditorState(asTemplate(baseState([section])));
    const color = back.sections.find((s) => s.kind === 'color') as Extract<EditorSection, { kind: 'color' }>;
    expect(color.images?.[0]).not.toHaveProperty('shape');
  });

  it('emits and round-trips an image overlay entrance motion', () => {
    const section: EditorSection = {
      ...(newSection('color') as Extract<EditorSection, { kind: 'color' }>),
      images: [{ id: 'i', choice: { source: 'url', url: '/logo.png' }, motion: 'slide-left' }],
    };
    const input = buildDescriptor(baseState([section])).sections?.find((s) => s.inputs)?.inputs?.[0];
    expect(input?.options).toMatchObject({ motion: 'slide-left' });

    const back = toEditorState(asTemplate(baseState([section])));
    const color = back.sections.find((s) => s.kind === 'color') as Extract<EditorSection, { kind: 'color' }>;
    expect(color.images?.[0]).toMatchObject({ motion: 'slide-left' });
  });
});

// --- whole-video (global) animations ---

describe('templateEditorModel — global animations', () => {
  it('emits state.globalAnimations into global.animations with pruned options', () => {
    const d = buildDescriptor(
      baseState({
        globalAnimations: [
          { url: '/assets/animations/glow_border.apng', opacity: 0.3 },
          { url: '/assets/animations/light_leak.apng', position: '10:20', loop: false },
        ],
      })
    );

    expect(d.global?.animations).toEqual([
      { url: '/assets/animations/glow_border.apng', loop: true, persistent: true, opacity: 0.3 },
      { url: '/assets/animations/light_leak.apng', loop: false, persistent: true, position: '10:20' },
    ]);
    expect(() => TemplateDescriptorSchema.parse(d)).not.toThrow();
  });

  it('omits global.animations when there are none', () => {
    const d = buildDescriptor(baseState([newSection('video')]));

    expect(d.global?.animations).toBeUndefined();
  });

  it('round-trips global animations back into the editor (non-default options only)', () => {
    const state = baseState({
      globalAnimations: [{ url: '/assets/animations/glow_border.apng', opacity: 0.3 }],
    });
    const back = toEditorState(asTemplate(state));

    expect(back.globalAnimations).toEqual([
      { id: 'global_animation_0', url: '/assets/animations/glow_border.apng', opacity: 0.3 },
    ]);
  });

  it('emits and round-trips global text overlays + look/grade, and stays schema-valid', () => {
    const state = baseState({
      globalOverlays: [{ text: { en: '{{ brand }}' }, position: 'top-right', reveal: 'fade' }],
      globalLook: 'cinematic',
      globalGrade: { saturation: 1.1 },
    });
    const d = buildDescriptor(state);

    expect(d.global?.overlays).toEqual([{ text: { en: '{{ brand }}' }, position: 'top-right', reveal: 'fade' }]);
    expect(d.global?.look).toBe('cinematic');
    expect(d.global?.grade).toEqual({ saturation: 1.1 });
    expect(() => TemplateDescriptorSchema.parse(d)).not.toThrow();

    const back = toEditorState(asTemplate(state));
    expect(back.globalOverlays).toEqual(state.globalOverlays);
    expect(back.globalLook).toBe('cinematic');
    expect(back.globalGrade).toEqual({ saturation: 1.1 });
  });
});

describe('templateEditorModel — watermark', () => {
  it('omits global.watermark when none is set', () => {
    const d = buildDescriptor(baseState([newSection('video')]));

    expect(d.global?.watermark).toBeUndefined();
  });

  it('emits global.watermark from a library MediaChoice, with presentation fields, and stays schema-valid', () => {
    const state = baseState({
      watermark: {
        image: { source: 'library', id: 'brand-logo' },
        position: 'top-left',
        scale: 0.2,
        opacity: 0.6,
        margin: 40,
      },
    });
    const d = buildDescriptor(state);

    expect(d.global?.watermark).toEqual({
      url: 'library://brand-logo',
      position: 'top-left',
      scale: 0.2,
      opacity: 0.6,
      margin: 40,
    });
    expect(() => TemplateDescriptorSchema.parse(d)).not.toThrow();
  });

  it('emits global.watermark from an upload MediaChoice as a media:// marker', () => {
    const d = buildDescriptor(
      baseState({ watermark: { image: { source: 'upload', key: 'abc123', label: 'logo.png' } } })
    );

    expect(d.global?.watermark).toEqual({ url: 'media://abc123' });
  });

  it('emits global.watermark from a url MediaChoice as-is', () => {
    const d = buildDescriptor(
      baseState({ watermark: { image: { source: 'url', url: 'https://example.com/logo.png' } } })
    );

    expect(d.global?.watermark).toEqual({ url: 'https://example.com/logo.png' });
  });

  it('round-trips a library watermark back into the editor with presentation fields', () => {
    const state = baseState({
      watermark: {
        image: { source: 'library', id: 'brand-logo' },
        position: 'bottom-right',
        scale: 0.12,
        opacity: 0.8,
        margin: 24,
      },
    });
    const back = toEditorState(asTemplate(state));

    expect(back.watermark).toEqual(state.watermark);
  });

  it('round-trips an upload watermark back into the editor (label falls back to the key)', () => {
    const state = baseState({ watermark: { image: { source: 'upload', key: 'abc123', label: 'logo.png' } } });
    const back = toEditorState(asTemplate(state));

    // media:// markers lose the human label across the descriptor, same as image overlays.
    expect(back.watermark).toEqual({ image: { source: 'upload', key: 'abc123', label: 'abc123' } });
  });

  it('round-trips a url watermark back into the editor', () => {
    const state = baseState({ watermark: { image: { source: 'url', url: 'https://example.com/logo.png' } } });
    const back = toEditorState(asTemplate(state));

    expect(back.watermark).toEqual(state.watermark);
  });

  it('round-trips with no presentation fields set (defaults stay absent)', () => {
    const state = baseState({ watermark: { image: { source: 'library', id: 'brand-logo' } } });
    const d = buildDescriptor(state);

    expect(d.global?.watermark).toEqual({ url: 'library://brand-logo' });

    const back = toEditorState(asTemplate(state));
    expect(back.watermark).toEqual(state.watermark);
  });

  it('omits watermark from the round-tripped editor state when never set', () => {
    const back = toEditorState(asTemplate(baseState([newSection('video')])));

    expect(back.watermark).toBeUndefined();
  });
});

describe('templateEditorModel — text sugar (titleCard / lowerThird / caption reveal)', () => {
  it('round-trips a titleCard on a color section', () => {
    const titleCard = {
      kicker: { en: 'HELLO' },
      headline: { en: 'World' },
      accent: '#7C83FF',
      reveal: 'rise' as const,
      // Per-line style overrides ride the whole-object pass-through and must survive the round-trip.
      kickerStyle: { font: 'bebas', fontsize: 30, color: '#ff0000' },
      headlineStyle: { color: '#00ff00' },
      subtitleStyle: { fontsize: 40 },
    };
    const color: EditorSection = { ...(newSection('color') as Extract<EditorSection, { kind: 'color' }>), titleCard };
    const d = buildDescriptor(baseState([color]));

    const colorOut = d.sections?.find((s) => s.type === 'color_background') as Record<string, unknown> | undefined;
    expect(colorOut?.titleCard).toEqual(titleCard);
    expect(() => TemplateDescriptorSchema.parse(d)).not.toThrow();

    const back = toEditorState(asTemplate(baseState([color])));
    const restored = back.sections.find((s) => s.kind === 'color') as Extract<EditorSection, { kind: 'color' }>;
    expect(restored.titleCard).toEqual(titleCard);
  });

  it('round-trips a lowerThird on a video section', () => {
    const lowerThird = { title: { en: 'Aurora' }, badge: { en: '$199' }, accent: '#7C83FF', bandColor: '#22101a' };
    const video: EditorSection = {
      ...(newSection('video') as Extract<EditorSection, { kind: 'video' }>),
      overlays: [],
      lowerThird,
    };
    const d = buildDescriptor(baseState([video]));

    const videoOut = d.sections?.find((s) => s.type === 'project_video') as Record<string, unknown> | undefined;
    expect(videoOut?.lowerThird).toEqual(lowerThird);
    expect(() => TemplateDescriptorSchema.parse(d)).not.toThrow();

    const back = toEditorState(asTemplate(baseState([video])));
    const restored = back.sections.find((s) => s.kind === 'video') as Extract<EditorSection, { kind: 'video' }>;
    expect(restored.lowerThird).toEqual(lowerThird);
  });

  it('emits and round-trips a caption reveal', () => {
    const video: EditorSection = {
      ...(newSection('video') as Extract<EditorSection, { kind: 'video' }>),
      overlays: [],
      caption: { text: 'Hi', reveal: 'slide-left' },
    };
    const d = buildDescriptor(baseState([video]));

    expect(d.sections?.find((s) => s.type === 'project_video')?.caption?.reveal).toBe('slide-left');

    const back = toEditorState(asTemplate(baseState([video])));
    const restored = back.sections.find((s) => s.kind === 'video') as Extract<EditorSection, { kind: 'video' }>;
    expect(restored.caption?.reveal).toBe('slide-left');
  });

  it('emits exactly one playback extent — duration wins and loop is omitted', () => {
    const d = buildDescriptor(
      baseState({
        globalAnimations: [{ url: '/assets/animations/light_leak.apng', duration: 8, start: 3, opacity: 0.35 }],
      })
    );

    expect(d.global?.animations?.[0]).toEqual({
      url: '/assets/animations/light_leak.apng',
      duration: 8,
      persistent: true,
      start: 3,
      opacity: 0.35,
    });
    expect(d.global?.animations?.[0]).not.toHaveProperty('loop');
    expect(() => TemplateDescriptorSchema.parse(d)).not.toThrow();
  });

  it('emits a finite loop count instead of loop', () => {
    const d = buildDescriptor(baseState({ globalAnimations: [{ url: '/assets/animations/sparkle.apng', loops: 3 }] }));

    expect(d.global?.animations?.[0]).toEqual({ url: '/assets/animations/sparkle.apng', loops: 3, persistent: true });
  });

  it('round-trips duration + start back into the editor', () => {
    const state = baseState({
      globalAnimations: [{ url: '/assets/animations/light_leak.apng', duration: 8, start: 3 }],
    });
    const back = toEditorState(asTemplate(state));

    expect(back.globalAnimations).toEqual([
      { id: 'global_animation_0', url: '/assets/animations/light_leak.apng', duration: 8, start: 3 },
    ]);
  });

  it('emits and round-trips a rotation on a whole-video animation', () => {
    const state = baseState({
      globalAnimations: [{ url: '/assets/animations/glow_border.apng', rotation: 30 }],
    });
    const d = buildDescriptor(state);

    expect(d.global?.animations).toEqual([
      { url: '/assets/animations/glow_border.apng', loop: true, persistent: true, rotation: 30 },
    ]);
    expect(() => TemplateDescriptorSchema.parse(d)).not.toThrow();

    const back = toEditorState(asTemplate(state));

    expect(back.globalAnimations).toEqual([
      { id: 'global_animation_0', url: '/assets/animations/glow_border.apng', rotation: 30 },
    ]);
  });
});

// --- image overlays (multiple draggable images) ---

describe('templateEditorModel — image overlays', () => {
  function videoWith(over: Partial<Extract<EditorSection, { kind: 'video' }>>): EditorState {
    return baseState([{ ...(newSection('video') as Extract<EditorSection, { kind: 'video' }>), ...over }]);
  }

  it('emits each image as a type:"image" input named by index, with markers + position/scale', () => {
    const d = buildDescriptor(
      videoWith({
        images: [
          { id: 'a', choice: { source: 'library', id: 'forest-sea' }, position: '0:0', scale: '1280:-1' },
          {
            id: 'b',
            choice: { source: 'upload', key: 'media-abc', label: 'logo.png' },
            position: '40:40',
            scale: '120:-1',
          },
        ],
      })
    );
    const video = d.sections?.find((s) => s.type === 'project_video');

    expect(video?.inputs).toEqual([
      { name: 'image_0', url: 'library://forest-sea', type: 'image', options: { position: '0:0', scale: '1280:-1' } },
      { name: 'image_1', url: 'media://media-abc', type: 'image', options: { position: '40:40', scale: '120:-1' } },
    ]);
  });

  it('composites the animation first, then the images in array order on top', () => {
    const d = buildDescriptor(
      videoWith({
        animations: [{ id: 'x', url: '/assets/animations/border.apng', label: 'b' }],
        images: [
          { id: 'a', choice: { source: 'url', url: 'https://x/bg.jpg' } },
          { id: 'b', choice: { source: 'url', url: 'https://x/logo.png' } },
        ],
      })
    );
    const video = d.sections?.find((s) => s.type === 'project_video');

    expect(video?.inputs?.map((i) => i.name)).toEqual(['animation_0', 'image_0', 'image_1']);
    expect(video?.inputs?.find((i) => i.name === 'image_0')?.url).toBe('https://x/bg.jpg');
  });

  it('passes a nonzero rotation through an image input options, and omits it when upright', () => {
    const d = buildDescriptor(
      videoWith({
        images: [
          { id: 'a', choice: { source: 'library', id: 'forest-sea' }, rotation: 45 },
          { id: 'b', choice: { source: 'library', id: 'desert' }, rotation: 0 },
        ],
      })
    );
    const video = d.sections?.find((s) => s.type === 'project_video');

    expect(video?.inputs).toEqual([
      { name: 'image_0', url: 'library://forest-sea', type: 'image', options: { rotation: 45 } },
      { name: 'image_1', url: 'library://desert', type: 'image', options: {} },
    ]);
  });

  it('round-trips an image rotation back into the editor', () => {
    const state = videoWith({
      images: [{ id: 'a', choice: { source: 'library', id: 'forest-sea' }, rotation: 45 }],
    });
    const restored = toEditorState(asTemplate(state));
    const video = restored.sections.find((s) => s.kind === 'video') as Extract<EditorSection, { kind: 'video' }>;

    expect(video.images).toEqual([{ id: 'image_0', choice: { source: 'library', id: 'forest-sea' }, rotation: 45 }]);
  });

  it('passes a faded opacity through an image input options', () => {
    const d = buildDescriptor(
      videoWith({ images: [{ id: 'a', choice: { source: 'library', id: 'forest-sea' }, opacity: 0.4 }] })
    );
    const video = d.sections?.find((s) => s.type === 'project_video');

    expect(video?.inputs).toEqual([
      { name: 'image_0', url: 'library://forest-sea', type: 'image', options: { opacity: 0.4 } },
    ]);
  });

  it('omits opacity from an image input options when fully opaque', () => {
    const d = buildDescriptor(
      videoWith({
        images: [
          { id: 'a', choice: { source: 'library', id: 'forest-sea' }, opacity: 1 },
          { id: 'b', choice: { source: 'library', id: 'desert' } },
        ],
      })
    );
    const video = d.sections?.find((s) => s.type === 'project_video');

    expect(video?.inputs).toEqual([
      { name: 'image_0', url: 'library://forest-sea', type: 'image', options: {} },
      { name: 'image_1', url: 'library://desert', type: 'image', options: {} },
    ]);
  });

  it('round-trips a faded image opacity back into the editor', () => {
    const state = videoWith({
      images: [{ id: 'a', choice: { source: 'library', id: 'forest-sea' }, opacity: 0.4 }],
    });
    const restored = toEditorState(asTemplate(state));
    const video = restored.sections.find((s) => s.kind === 'video') as Extract<EditorSection, { kind: 'video' }>;

    expect(video.images).toEqual([{ id: 'image_0', choice: { source: 'library', id: 'forest-sea' }, opacity: 0.4 }]);
  });

  it('round-trips image markers back to editor MediaChoices via toEditorState', () => {
    const state = videoWith({
      images: [
        { id: 'a', choice: { source: 'library', id: 'forest-sea' }, position: '10:20' },
        { id: 'b', choice: { source: 'upload', key: 'media-abc', label: 'logo.png' } },
      ],
    });
    const restored = toEditorState(asTemplate(state));
    const video = restored.sections.find((s) => s.kind === 'video') as Extract<EditorSection, { kind: 'video' }>;

    expect(video.images).toEqual([
      { id: 'image_0', choice: { source: 'library', id: 'forest-sea' }, position: '10:20' },
      { id: 'image_1', choice: { source: 'upload', key: 'media-abc', label: 'media-abc' } },
    ]);
  });
});

// --- partial sections ---

describe('templateEditorModel — partial section', () => {
  it('emits a compact partial reference descriptor', () => {
    const descriptor = buildDescriptor(
      baseState([
        {
          kind: 'partial',
          ref: 'local:intro',
          prefix: 'intro_',
          variables: [
            { name: 'title', value: 'Launch' },
            { name: '', value: 'ignored' },
          ],
        },
        newSection('video'),
      ])
    );

    expect(descriptor.sections?.[0]).toEqual({
      name: 'partial_1',
      type: 'partial',
      ref: 'local:intro',
      prefix: 'intro_',
      variables: { title: 'Launch' },
    });
  });

  it('rehydrates partial references instead of dropping them', () => {
    const state = toEditorState({
      id: 'user-1',
      name: 'T',
      description: '',
      orientation: 'landscape',
      descriptor: {
        global: { orientation: 'landscape' },
        sections: [
          {
            type: 'partial',
            ref: 'local:intro',
            prefix: 'intro_',
            variables: { title: 'Launch' },
          },
          {
            name: 'video_1',
            type: 'project_video',
            options: { duration: 4 },
          },
        ],
      },
    });

    expect(state.sections[0]).toEqual({
      kind: 'partial',
      ref: 'local:intro',
      prefix: 'intro_',
      variables: [{ name: 'title', value: 'Launch' }],
    });
    expect(state.sections[1].kind).toBe('video');
  });
});

// --- music section ---

describe('templateEditorModel — music section', () => {
  it('folds a music section into global.musicEnabled/allowedMusic/allowUploadMusic', () => {
    const d = buildDescriptor(
      baseState([newSection('video'), { kind: 'music', allowed: [music1, music2], allowUpload: true }])
    );

    expect(d.global?.musicEnabled).toBe(true);
    expect(d.global?.allowedMusic).toEqual([music1, music2]);
    expect(d.global?.allowUploadMusic).toBe(true);
    expect(d.sections?.some((s) => s.type === 'music')).toBe(false);
  });

  it('emits allowUploadMusic:false when uploads are not allowed', () => {
    const d = buildDescriptor(baseState([{ kind: 'music', allowed: [music1], allowUpload: false }]));

    expect(d.global?.allowUploadMusic).toBe(false);
  });

  it('leaves music globals off (musicEnabled:false) when there is no music section', () => {
    const d = buildDescriptor(baseState([newSection('video')]));

    expect(d.global?.musicEnabled).toBe(false);
    expect(d.global?.allowedMusic).toBeUndefined();
    expect(d.global?.allowUploadMusic).toBeUndefined();
  });

  it('treats an upload-only music section (no shortlist) as enabled', () => {
    const d = buildDescriptor(baseState([{ kind: 'music', allowed: [], allowUpload: true }]));

    expect(d.global?.musicEnabled).toBe(true);
    expect(d.global?.allowedMusic).toEqual([]);
    expect(d.global?.allowUploadMusic).toBe(true);
  });
});

// --- image section ---

describe('templateEditorModel — image section', () => {
  it('emits an image_background descriptor section with its duration + background globals', () => {
    const d = buildDescriptor(
      baseState([{ kind: 'image', allowed: [bg1, bg2], allowUpload: true, duration: 6, overlays: [] }])
    );

    const imageSection = d.sections?.find((s) => s.type === 'image_background');

    expect(imageSection).toMatchObject({ name: 'image_1', type: 'image_background', options: { duration: 6 } });
    expect((imageSection?.options as { pictureUrl?: string } | undefined)?.pictureUrl).toBeUndefined();
    expect(d.global?.allowedBackgrounds).toEqual([bg1, bg2]);
    expect(d.global?.allowUploadBackground).toBe(true);
  });

  it('numbers multiple image sections image_1, image_2 and de-duplicates the global union', () => {
    const d = buildDescriptor(
      baseState([
        { kind: 'image', allowed: [bg1], allowUpload: false, duration: 4, overlays: [] },
        { kind: 'image', allowed: [bg1, bg2], allowUpload: true, duration: 5, overlays: [] },
      ])
    );

    const imageSections = (d.sections ?? []).filter((s) => s.type === 'image_background');

    expect(imageSections.map((s) => s.name)).toEqual(['image_1', 'image_2']);
    expect(imageSections.map((s) => s.options?.duration)).toEqual([4, 5]);
    expect(d.global?.allowedBackgrounds).toEqual([bg1, bg2]);
    expect(d.global?.allowUploadBackground).toBe(true);
  });

  it('leaves background globals off and emits no image_background when there is no image section', () => {
    const d = buildDescriptor(baseState([newSection('video')]));

    expect(d.global?.allowedBackgrounds).toBeUndefined();
    expect(d.global?.allowUploadBackground).toBeUndefined();
    expect(d.sections?.some((s) => s.type === 'image_background')).toBe(false);
  });
});

// --- form/video/color numbering ---

describe('templateEditorModel — form/video/color', () => {
  it('maps form/video/color sections to a descriptor and numbers videos independently', () => {
    const descriptor = buildDescriptor(
      baseState([newSection('form'), videoSection([]), newSection('color'), videoSection([])])
    );

    const sections = descriptor.sections ?? [];
    expect(sections.map((s) => s.type)).toEqual(['form', 'project_video', 'color_background', 'project_video']);
    expect(sections[1].name).toBe('video_1');
    expect(sections[3].name).toBe('video_2');
    expect(sections[0].options?.fields).toEqual([{ name: 'field_1', maxLength: 40, label: { en: 'Label' } }]);
    expect(sections[2].options).toEqual({ duration: 3, backgroundColor: '#7C83FD' });
  });
});

// --- video overlays → drawtext filters ---

describe('templateEditorModel — video overlays → drawtext filters', () => {
  it('writes the centered fractions into drawtext x/y at the default position', () => {
    const values = drawtextValues(baseState([videoSection([overlay({ text: 'Hello' })])]));

    expect(values?.x).toBe('(w-text_w)*0.5');
    expect(values?.y).toBe('(h-text_h)*0.5');
  });

  it('feeds custom x/y and font styling into the drawtext values', () => {
    const o = overlay({ text: 'Hello', x: 0.25, y: 0.8, fontsize: 64, fontcolor: '#ff0000' });
    const values = drawtextValues(baseState([videoSection([o])]));

    expect(values).toMatchObject({
      text: { en: 'Hello' },
      fontsize: 64,
      fontcolor: '#ff0000',
      fontfile: 'Rubik.ttf',
      x: '(w-text_w)*0.25',
      y: '(h-text_h)*0.8',
    });
  });

  it('rounds the fractions to 3 decimals and clamps them to [0, 1]', () => {
    const values = drawtextValues(baseState([videoSection([overlay({ text: 'Hi', x: 0.123456, y: 1.5 })])]));

    expect(values?.x).toBe('(w-text_w)*0.123');
    expect(values?.y).toBe('(h-text_h)*1');
  });

  it('emits box/boxcolor/boxborderw only when the overlay opts into a box', () => {
    const boxed = drawtextValues(
      baseState([videoSection([overlay({ text: 'Boxed', box: true, boxcolor: '#112233' })])])
    );

    expect(boxed).toMatchObject({ box: 1, boxcolor: '#112233@0.5', boxborderw: 12 });

    const plain = drawtextValues(baseState([videoSection([overlay({ text: 'Plain', box: false })])]));

    expect(plain).not.toHaveProperty('box');
    expect(plain).not.toHaveProperty('boxcolor');
  });

  it('suffixes fontcolor with the text opacity only when the overlay sets one', () => {
    const faded = drawtextValues(baseState([videoSection([overlay({ text: 'Watermark', textOpacity: 0.35 })])]));

    expect(faded?.fontcolor).toBe('#ffffff@0.35');

    const solid = drawtextValues(baseState([videoSection([overlay({ text: 'Solid' })])]));

    expect(solid?.fontcolor).toBe('#ffffff');
  });

  it('emits one drawtext filter per non-empty overlay, in order, skipping blanks', () => {
    const filters = drawtextFilters(
      baseState([videoSection([overlay({ text: 'Keep' }), overlay({ text: '   ' }), overlay({ text: 'Me' })])])
    );

    expect(filters).toHaveLength(2);
    expect(filters.map((f) => (f.text as { en: string }).en)).toEqual(['Keep', 'Me']);
  });

  it('emits no filters when there are no overlays or all are empty', () => {
    const none = buildDescriptor(baseState([videoSection([])]));

    expect(none.sections?.find((s) => s.type === 'project_video')?.filters).toBeUndefined();

    const allEmpty = buildDescriptor(baseState([videoSection([overlay({ text: '' }), overlay({ text: '  ' })])]));

    expect(allEmpty.sections?.find((s) => s.type === 'project_video')?.filters).toBeUndefined();
  });

  it('emits and round-trips a text-overlay entrance reveal and timed exit', () => {
    const animated = overlay({
      text: 'Bye',
      reveal: 'rise' as const,
      exit: { type: 'fade', after: 2.5, easing: 'ease-out' },
    });
    const d = buildDescriptor(baseState([videoSection([animated])]));
    const filter = (d.sections?.find((s) => s.type === 'project_video')?.filters ?? [])[0];

    expect(filter.reveal).toBe('rise');
    expect(filter.exit).toEqual({ type: 'fade', after: 2.5, easing: 'ease-out' });
    expect(() => TemplateDescriptorSchema.parse(d)).not.toThrow();

    const back = toEditorState(asTemplate(baseState([videoSection([animated])])));
    const recovered = back.sections.find((s) => s.kind === 'video') as Extract<EditorSection, { kind: 'video' }>;
    expect(recovered.overlays[0]).toMatchObject({
      text: 'Bye',
      reveal: 'rise',
      exit: { type: 'fade', after: 2.5, easing: 'ease-out' },
    });
  });
});

describe('native timing editor roundtrip', () => {
  it('preserves title-card zero/short stagger and reveal easing through descriptor import/export', () => {
    for (const stagger of [0, 0.07]) {
      const titleCard = {
        headline: { en: 'A headline' },
        stagger,
        reveal: { type: 'rise' as const, easing: 'ease-out' as const },
      };
      const state = baseState([{ ...(newSection('color') as Extract<EditorSection, { kind: 'color' }>), titleCard }]);
      const descriptor = buildDescriptor(state);
      expect(() => TemplateDescriptorSchema.parse(descriptor)).not.toThrow();
      const imported = toEditorState(asTemplate(state));
      const color = imported.sections.find((section) => section.kind === 'color') as Extract<
        EditorSection,
        { kind: 'color' }
      >;
      expect(color.titleCard).toEqual(titleCard);
      const emitted = buildDescriptor(imported).sections?.find((section) => section.type === 'color_background');
      expect(emitted && 'titleCard' in emitted ? emitted.titleCard : undefined).toEqual(titleCard);
    }
  });
});

// --- overlay accent bar ---

describe('templateEditorModel — overlay accent bar', () => {
  const accented = (over: Partial<TextOverlay> = {}) =>
    overlay({ text: 'Title', x: 0.25, y: 0.8, fontsize: 50, accent: '#ff8800', ...over });

  const videoOverlays = (state: EditorState): TextOverlay[] => {
    const back = toEditorState(asTemplate(state));
    const video = back.sections.find((s) => s.kind === 'video') as Extract<EditorSection, { kind: 'video' }>;

    return video.overlays;
  };

  it('emits a drawbox accent bar right after the drawtext, sized from the fontsize', () => {
    const d = buildDescriptor(baseState([videoSection([accented()])]));
    const filters = d.sections?.find((s) => s.type === 'project_video')?.filters ?? [];

    expect(filters.map((f) => f.type)).toEqual(['drawtext', 'drawbox']);
    // width = fontsize*6 centered on the x anchor; height max(4, fontsize*0.12); the bar sits one
    // approximated text height (fontsize*1.2) plus a fontsize*0.25 gap below the drawtext y anchor.
    expect(filters[1].values).toEqual({
      x: '(iw-300)*0.25',
      y: '(ih-60)*0.8+73',
      w: 300,
      h: 6,
      c: '#ff8800@1',
      t: 'fill',
    });
    expect(() => TemplateDescriptorSchema.parse(d)).not.toThrow();
  });

  it('emits no drawbox when the overlay has no accent (backward compatible)', () => {
    const d = buildDescriptor(baseState([videoSection([overlay({ text: 'Plain' })])]));
    const filters = d.sections?.find((s) => s.type === 'project_video')?.filters ?? [];

    expect(filters.map((f) => f.type)).toEqual(['drawtext']);
  });

  it('round-trips the accent and keeps accent-less overlays clean of the field', () => {
    const overlays = [accented(), overlay({ text: 'Plain', y: 0.9 })];
    const recovered = videoOverlays(baseState([videoSection(overlays)]));

    expect(recovered).toEqual(overlays);
    expect(recovered[0].accent).toBe('#ff8800');
    expect(recovered[1]).not.toHaveProperty('accent');
  });

  it('pairs each accent bar with its own drawtext across multiple overlays', () => {
    const overlays = [
      accented({ text: 'One', accent: '#ff0000' }),
      overlay({ text: 'Two', y: 0.6 }),
      accented({ text: 'Three', y: 0.9, accent: '#00ff00' }),
    ];
    const recovered = videoOverlays(baseState([videoSection(overlays)]));

    expect(recovered).toEqual(overlays);
  });

  it('rebuilds an identical descriptor after a round-trip', () => {
    const state = baseState([videoSection([accented()])]);
    const back = toEditorState(asTemplate(state));

    expect(buildDescriptor(back)).toEqual(buildDescriptor(state));
  });

  it('does not claim a hand-authored drawbox that lacks the accent-bar signature', () => {
    const descriptor = {
      sections: [
        {
          name: 'video_1',
          type: 'project_video',
          options: { duration: 8, muteSection: false },
          filters: [
            {
              type: 'drawtext',
              values: {
                text: { en: 'Hi' },
                fontsize: 48,
                fontcolor: '#ffffff',
                fontfile: 'Rubik.ttf',
                x: '(w-text_w)*0.5',
                y: '(h-text_h)*0.5',
              },
            },
            // A full-frame wash, not a kit accent bar: numeric x, no `(iw-…)*fraction` form.
            { type: 'drawbox', values: { x: 0, y: 0, w: 100, h: 100, c: '#000000@1', t: 'fill' } },
          ],
        },
      ],
    } as unknown as TemplateDescriptor;
    const back = toEditorState({ id: 'user-x', name: 'T', description: '', orientation: 'landscape', descriptor });
    const video = back.sections.find((s) => s.kind === 'video') as Extract<EditorSection, { kind: 'video' }>;

    expect(video.overlays).toHaveLength(1);
    expect(video.overlays[0]).not.toHaveProperty('accent');
  });
});

// --- per-overlay font + global variables ---

describe('templateEditorModel — per-overlay font + global variables', () => {
  it('emits the chosen fontfile per overlay', () => {
    const d = buildDescriptor(baseState([videoSection([overlay({ text: 'Hi', font: 'oswald' })])]));

    expect((d.sections?.find((s) => s.type === 'project_video')?.filters ?? [])[0].values?.fontfile).toBe('Oswald.ttf');
  });

  it('writes author global variables into global.variables', () => {
    const d = buildDescriptor(baseState({ globalVariables: [{ name: 'brand', value: 'LeClap' }] }));

    expect(d.global?.variables?.brand).toBe('LeClap');
  });

  it('collectVariables unions form fields and global vars', () => {
    const s = baseState({
      globalVariables: [{ name: 'brand', value: 'X' }],
      sections: [{ kind: 'form', fields: [{ name: 'firstname', label: 'First', maxLength: 40 }] }],
    });

    expect(collectVariables(s)).toEqual(expect.arrayContaining(['firstname', 'brand']));
  });
});

// --- parseFraction ---

describe('templateEditorModel — parseFraction', () => {
  it('extracts the multiplier from a (w-text_w)*<frac> expression', () => {
    expect(parseFraction('(w-text_w)*0.25')).toBe(0.25);
    expect(parseFraction('(h-text_h)*0.8')).toBe(0.8);
  });

  it('defaults to 0.5 for the legacy centered /2 form and unparseable values', () => {
    expect(parseFraction('(w-text_w)/2')).toBe(0.5);
    expect(parseFraction()).toBe(0.5);
    expect(parseFraction(120)).toBe(0.5);
    expect(parseFraction('center')).toBe(0.5);
  });

  it('clamps parsed fractions to [0, 1]', () => {
    expect(parseFraction('(w-text_w)*1.5')).toBe(1);
    expect(parseFraction('(w-text_w)*0')).toBe(0);
  });
});

// --- round-trips ---

describe('templateEditorModel — round-trips', () => {
  it('round-trips multiple overlays (text, position, font, box) through a stored template', () => {
    const overlays = [
      overlay({ text: 'Title', x: 0.25, y: 0.75, fontsize: 64, fontcolor: '#ff0000' }),
      overlay({ text: 'Subtitle', x: 0.5, y: 0.9, box: true, boxcolor: '#102030' }),
    ];
    const back = toEditorState(asTemplate(baseState([videoSection(overlays)])));
    const video = back.sections.find((s) => s.kind === 'video') as Extract<EditorSection, { kind: 'video' }>;

    expect(video.overlays).toEqual(overlays);
  });

  it('round-trips box opacity and font', () => {
    const o = overlay({ text: 'Hi', box: true, boxcolor: '#000000', boxOpacity: 0.3, font: 'pacifico' });
    const back = toEditorState(asTemplate(baseState([videoSection([o])])));
    const video = back.sections.find((s) => s.kind === 'video') as Extract<EditorSection, { kind: 'video' }>;

    expect(video.overlays[0].boxOpacity).toBeCloseTo(0.3);
    expect(video.overlays[0].font).toBe('pacifico');
  });

  it('round-trips the text opacity and keeps the recovered fontcolor clean of the alpha token', () => {
    const o = overlay({ text: 'Watermark', fontcolor: '#ff8800', textOpacity: 0.35 });
    const back = toEditorState(asTemplate(baseState([videoSection([o])])));
    const video = back.sections.find((s) => s.kind === 'video') as Extract<EditorSection, { kind: 'video' }>;

    expect(video.overlays[0].textOpacity).toBeCloseTo(0.35);
    expect(video.overlays[0].fontcolor).toBe('#ff8800');
  });

  it('leaves overlays without a text opacity free of the field after a round-trip', () => {
    const back = toEditorState(asTemplate(baseState([videoSection([overlay({ text: 'Solid' })])])));
    const video = back.sections.find((s) => s.kind === 'video') as Extract<EditorSection, { kind: 'video' }>;

    expect(video.overlays[0]).not.toHaveProperty('textOpacity');
  });

  it('round-trips a music section, surfaced at the top', () => {
    const start = baseState([newSection('video'), { kind: 'music', allowed: [music1, music2], allowUpload: true }]);
    const back = toEditorState(asTemplate(start));

    expect(back.sections.find((s) => s.kind === 'music')).toEqual({
      kind: 'music',
      allowed: [music1, music2],
      allowUpload: true,
    });
    expect(back.sections[0].kind).toBe('music');
  });

  it('round-trips an image section (descriptor section + duration + globals)', () => {
    const start = baseState([{ kind: 'image', allowed: [bg1, bg2], allowUpload: true, duration: 7, overlays: [] }]);
    const back = toEditorState(asTemplate(start));

    expect(back.sections.find((s) => s.kind === 'image')).toEqual({
      kind: 'image',
      allowed: [bg1, bg2],
      allowUpload: true,
      duration: 7,
      overlays: [],
    });
  });

  it('reconstructs image sections at their descriptor position, music at the top', () => {
    const start = baseState([
      newSection('video'),
      { kind: 'image', allowed: [bg1], allowUpload: false, duration: 4, overlays: [] },
      { kind: 'music', allowed: [music1], allowUpload: false },
    ]);
    const back = toEditorState(asTemplate(start));

    expect(back.sections.map((s) => s.kind)).toEqual(['music', 'video', 'image']);
  });

  it('toEditorState returns a single blank video section for a null template', () => {
    const state = toEditorState(null);

    expect(state.sections).toHaveLength(1);
    expect(state.sections[0].kind).toBe('video');
    expect(state.audio).toEqual(DEFAULT_AUDIO_MIX);
    expect(state.defaultTransition).toEqual(DEFAULT_TRANSITION);
  });
});

// --- transitions/look/grade/motion/layers/framingGuide fields ---

describe('templateEditorModel — transitions/look/grade/motion/layers fields', () => {
  it('maps audio (sourceVolume/musicVolume/normalize/ducking) to global.audio', () => {
    const d = buildDescriptor(
      baseState({ audio: { sourceVolume: 0.7, musicVolume: 0.3, normalize: 'loudnorm', ducking: true } })
    );

    expect(d.global?.audio).toEqual({ sourceVolume: 0.7, musicVolume: 0.3, normalize: 'loudnorm', ducking: true });
  });

  it('omits normalize and ducking from global.audio when unset/disabled', () => {
    const d = buildDescriptor(baseState({ audio: { sourceVolume: 1, musicVolume: 0.5, ducking: false } }));

    expect(d.global?.audio).toEqual({ sourceVolume: 1, musicVolume: 0.5 });
  });

  it('round-trips the audio mix including normalize/ducking', () => {
    const state = baseState({ audio: { sourceVolume: 0.6, musicVolume: 0.2, normalize: 'dynaudnorm', ducking: true } });
    const back = toEditorState(asTemplate(state));

    expect(back.audio).toEqual({ sourceVolume: 0.6, musicVolume: 0.2, normalize: 'dynaudnorm', ducking: true });
  });

  it('maps defaultTransition to global.transition and back', () => {
    const state = baseState({ defaultTransition: { type: 'fade', duration: 0.8 } });
    const d = buildDescriptor(state);

    expect(d.global?.transition).toEqual({ type: 'fade', duration: 0.8 });
    expect(toEditorState(asTemplate(state)).defaultTransition).toEqual({ type: 'fade', duration: 0.8 });
  });

  it('passes section transitionAfter through as section.transition and back', () => {
    const state = baseState([
      {
        ...(newSection('color') as Extract<EditorSection, { kind: 'color' }>),
        transitionAfter: { type: 'wipeleft', duration: 0.4 },
      },
    ]);
    const d = buildDescriptor(state);

    expect(d.sections?.[0].transition).toEqual({ type: 'wipeleft', duration: 0.4 });
    const back = toEditorState(asTemplate(state)).sections.find((s) => s.kind === 'color');

    expect((back as Extract<EditorSection, { kind: 'color' }>).transitionAfter).toEqual({
      type: 'wipeleft',
      duration: 0.4,
    });
  });

  it('passes look/grade/motion through on visual sections and back', () => {
    const motion = [{ type: 'kenburns' as const, direction: 'in' as const, intensity: 1.2 }];
    const grade = { brightness: 0.1, contrast: 1.2 };
    const state = baseState([
      {
        ...(newSection('video') as Extract<EditorSection, { kind: 'video' }>),
        look: 'cinematic',
        grade,
        motion,
      },
    ]);
    const d = buildDescriptor(state);
    const section = d.sections?.[0];

    expect(section?.look).toBe('cinematic');
    expect(section?.grade).toEqual(grade);
    expect(section?.motion).toEqual(motion);

    const back = toEditorState(asTemplate(state)).sections.find((s) => s.kind === 'video') as Extract<
      EditorSection,
      { kind: 'video' }
    >;

    expect(back.look).toBe('cinematic');
    expect(back.grade).toEqual(grade);
    expect(back.motion).toEqual(motion);
  });

  it('passes color-section layers through as options.layers and back', () => {
    // shape and angle ride along to prove new gradient fields round-trip opaquely (layers pass through as-is).
    const layers: BackgroundLayer[] = [
      { gradient: { from: '#000', to: '#fff', direction: 'vertical', shape: 'radial' }, opacity: 0.8 },
      { gradient: { from: '#111', to: '#eee', angle: 225 } },
    ];
    const state = baseState([{ ...(newSection('color') as Extract<EditorSection, { kind: 'color' }>), layers }]);
    const d = buildDescriptor(state);

    expect(d.sections?.[0].options?.layers).toEqual(layers);
    const back = toEditorState(asTemplate(state)).sections.find((s) => s.kind === 'color') as Extract<
      EditorSection,
      { kind: 'color' }
    >;

    expect(back.layers).toEqual(layers);
  });

  it('passes a layer border through as options.layers and back', () => {
    // border rides along to prove the outline fields round-trip opaquely — a stroked fill AND an
    // outline-only layer (no color) both survive buildDescriptor → toEditorState.
    const layers: BackgroundLayer[] = [
      { color: '#112233', opacity: 0.9, border: { color: '#FFFFFF', width: 4 } },
      { border: { color: '#00FF00', width: 8 }, x: 'iw*0.25', y: 'ih*0.25', w: 'iw*0.5', h: 'ih*0.5' },
    ];
    const state = baseState([{ ...(newSection('color') as Extract<EditorSection, { kind: 'color' }>), layers }]);
    const d = buildDescriptor(state);

    expect(d.sections?.[0].options?.layers).toEqual(layers);
    const back = toEditorState(asTemplate(state)).sections.find((s) => s.kind === 'color') as Extract<
      EditorSection,
      { kind: 'color' }
    >;

    expect(back.layers).toEqual(layers);
  });

  it('passes a project_video framingGuide through and back', () => {
    const framingGuide = { type: 'silhouette' as const, position: 'center' as const, opacity: 0.4 };
    const state = baseState([{ ...(newSection('video') as Extract<EditorSection, { kind: 'video' }>), framingGuide }]);
    const d = buildDescriptor(state);

    expect(d.sections?.[0].options?.framingGuide).toEqual(framingGuide);
    const back = toEditorState(asTemplate(state)).sections.find((s) => s.kind === 'video') as Extract<
      EditorSection,
      { kind: 'video' }
    >;

    expect(back.framingGuide).toEqual(framingGuide);
  });

  it('passes a project_video framingGuide style through and back', () => {
    const framingGuide = {
      type: 'silhouette' as const,
      position: 'right' as const,
      opacity: 0.45,
      style: 'outline' as const,
    };
    const state = baseState([{ ...(newSection('video') as Extract<EditorSection, { kind: 'video' }>), framingGuide }]);
    const d = buildDescriptor(state);

    expect(d.sections?.[0].options?.framingGuide).toEqual(framingGuide);
    const back = toEditorState(asTemplate(state)).sections.find((s) => s.kind === 'video') as Extract<
      EditorSection,
      { kind: 'video' }
    >;

    expect(back.framingGuide).toEqual(framingGuide);
  });
});

// --- "what to film" description ---

describe('templateEditorModel — video description', () => {
  const videoWith = (over: Partial<Extract<EditorSection, { kind: 'video' }>>): EditorSection => ({
    ...(newSection('video') as Extract<EditorSection, { kind: 'video' }>),
    ...over,
  });

  const videoSectionOf = (state: EditorState) =>
    buildDescriptor(state).sections?.find((s) => s.type === 'project_video');

  it('emits section.description = { en } when set', () => {
    const section = videoSectionOf(baseState([videoWith({ description: 'Say your name' })]));

    expect(section?.description).toEqual({ en: 'Say your name' });
  });

  it('omits description for an empty or whitespace-only value', () => {
    expect(videoSectionOf(baseState([videoWith({ description: '' })]))?.description).toBeUndefined();
    expect(videoSectionOf(baseState([videoWith({ description: '   ' })]))?.description).toBeUndefined();
    expect(videoSectionOf(baseState([newSection('video')]))?.description).toBeUndefined();
  });

  it('round-trips a description through a stored template', () => {
    const back = toEditorState(asTemplate(baseState([videoWith({ description: 'Look at the camera' })]))).sections.find(
      (s) => s.kind === 'video'
    );

    expect(back).toMatchObject({ description: 'Look at the camera' });
  });

  it('reads back the first locale when en is absent', () => {
    const template: EditableTemplate = {
      id: 'user-1',
      name: 'T',
      description: '',
      orientation: 'landscape',
      descriptor: { sections: [{ name: 'video_1', type: 'project_video', description: { fr: 'Souris' } }] },
    };
    const back = toEditorState(template).sections.find((s) => s.kind === 'video');

    expect(back).toMatchObject({ description: 'Souris' });
  });

  it('leaves description unset when the stored section has none', () => {
    const back = toEditorState(asTemplate(baseState([newSection('video')]))).sections.find((s) => s.kind === 'video');

    expect(back).not.toHaveProperty('description');
  });
});

// --- pure ops: duplicateSection / setTransitionAfter / patchLayers ---

describe('templateEditorModel — pure ops', () => {
  it('duplicateSection deep-copies the section and inserts the copy after it', () => {
    const state = baseState([videoSection([overlay({ text: 'Title' })]), newSection('color')]);
    const next = duplicateSection(state, 0);

    expect(next.sections).toHaveLength(3);
    expect(next.sections.map((s) => s.kind)).toEqual(['video', 'video', 'color']);

    const original = next.sections[0] as Extract<EditorSection, { kind: 'video' }>;
    const copy = next.sections[1] as Extract<EditorSection, { kind: 'video' }>;

    expect(original.overlays[0].text).toBe('Title');
    expect(copy.overlays[0].text).toBe('Title copy');
    // deep copy: mutating the copy does not touch the original
    expect(copy.overlays).not.toBe(original.overlays);
  });

  it('duplicateSection is a no-op for an out-of-range index', () => {
    const state = baseState([newSection('video')]);

    expect(duplicateSection(state, 5).sections).toHaveLength(1);
  });

  it('setTransitionAfter sets and clears a visual section transition', () => {
    const state = baseState([newSection('color')]);
    const withT = setTransitionAfter(state, 0, { type: 'fade', duration: 0.5 });

    expect((withT.sections[0] as Extract<EditorSection, { kind: 'color' }>).transitionAfter).toEqual({
      type: 'fade',
      duration: 0.5,
    });

    const cleared = setTransitionAfter(withT, 0, undefined);

    expect((cleared.sections[0] as Extract<EditorSection, { kind: 'color' }>).transitionAfter).toBeUndefined();
  });

  it('setTransitionAfter is a no-op on a music section', () => {
    const state = baseState([{ kind: 'music', allowed: [], allowUpload: false }]);

    expect(setTransitionAfter(state, 0, { type: 'fade' })).toBe(state);
  });

  it('patchLayers replaces layers on a color section only', () => {
    const layers: BackgroundLayer[] = [{ color: '#ff0000', opacity: 0.5 }];
    const state = baseState([newSection('color'), newSection('video')]);
    const next = patchLayers(state, 0, layers);

    expect((next.sections[0] as Extract<EditorSection, { kind: 'color' }>).layers).toEqual(layers);
    // non-color is untouched
    expect(patchLayers(state, 1, layers)).toBe(state);
  });
});

// --- history undo/redo ---

describe('templateEditorModel — createHistory', () => {
  it('starts with the initial state and no undo/redo available', () => {
    const h = createHistory(baseState([newSection('video')]));

    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.state.sections).toHaveLength(1);
  });

  it('set/undo/redo move through the history', () => {
    const h = createHistory(baseState([newSection('video')]));
    const next = addOne(h.state);

    h.set(next);
    expect(h.state.sections).toHaveLength(2);
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(false);

    h.undo();
    expect(h.state.sections).toHaveLength(1);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(true);

    h.redo();
    expect(h.state.sections).toHaveLength(2);
    expect(h.canRedo).toBe(false);
  });

  it('set clears the redo (future) stack', () => {
    const h = createHistory(baseState([newSection('video')]));

    h.set(addOne(h.state));
    h.undo();
    expect(h.canRedo).toBe(true);

    h.set(addOne(h.state));
    expect(h.canRedo).toBe(false);
  });

  it('bounds the undo stack at 50 entries', () => {
    const h = createHistory(baseState([newSection('video')]));

    for (let i = 0; i < 60; i += 1) {
      h.set(addOne(h.state));
    }

    // 60 sets recorded, but only the last 50 are undoable
    let undos = 0;
    while (h.canUndo) {
      h.undo();
      undos += 1;
    }

    expect(undos).toBe(50);
  });
});

function addOne(state: EditorState): EditorState {
  return { ...state, sections: [...state.sections, newSection('video')] };
}

// --- core schema validation guard ---

describe('templateEditorModel — core schema validation guard', () => {
  it('buildDescriptor(defaultState) passes core schema validation', () => {
    const result = TemplateDescriptorSchema.safeParse(buildDescriptor(baseState([newSection('video')])));

    expect(result.success).toBe(true);
  });

  it('a descriptor with all the structured fields passes core schema validation', () => {
    const state = baseState({
      audio: { sourceVolume: 0.7, musicVolume: 0.3, normalize: 'loudnorm', ducking: true },
      defaultTransition: { type: 'fade', duration: 0.6 },
      sections: [
        {
          ...(newSection('video') as Extract<EditorSection, { kind: 'video' }>),
          overlays: [overlay({ text: 'Hi' })],
          look: 'cinematic',
          grade: { brightness: 0.1 },
          motion: [{ type: 'kenburns', direction: 'in' }],
          framingGuide: { type: 'silhouette', position: 'center' },
          transitionAfter: { type: 'fade', duration: 0.4 },
        },
        {
          ...(newSection('color') as Extract<EditorSection, { kind: 'color' }>),
          layers: [{ gradient: { from: '#000', to: '#fff' } }],
        },
      ],
    });

    const result = TemplateDescriptorSchema.safeParse(buildDescriptor(state));

    expect(result.success).toBe(true);
  });
});

// --- per-section musicVolume + audioFade ---

describe('templateEditorModel — per-section musicVolume + audioFade', () => {
  it('emits options.musicVolume on a video section when set', () => {
    const state = baseState([
      {
        ...(newSection('video') as Extract<EditorSection, { kind: 'video' }>),
        musicVolume: 0.3,
      },
    ]);
    const d = buildDescriptor(state);

    expect(d.sections?.[0].options?.musicVolume).toBe(0.3);
  });

  it('omits options.musicVolume when not set', () => {
    const d = buildDescriptor(baseState([newSection('video')]));

    expect(d.sections?.[0].options?.musicVolume).toBeUndefined();
  });

  it('emits options.audioFade with in + out + curve on a video section', () => {
    const audioFade = {
      in: { duration: 0.5, curve: 'qsin' as const },
      out: { duration: 1.0, curve: 'exp' as const },
    };
    const state = baseState([
      {
        ...(newSection('video') as Extract<EditorSection, { kind: 'video' }>),
        audioFade,
      },
    ]);
    const d = buildDescriptor(state);

    expect(d.sections?.[0].options?.audioFade).toEqual(audioFade);
  });

  it('emits options.musicVolume + audioFade on a color section', () => {
    const audioFade = { in: { duration: 0.4 } };
    const state = baseState([
      {
        ...(newSection('color') as Extract<EditorSection, { kind: 'color' }>),
        musicVolume: 0.8,
        audioFade,
      },
    ]);
    const d = buildDescriptor(state);
    const opts = d.sections?.[0].options;

    expect(opts?.musicVolume).toBe(0.8);
    expect(opts?.audioFade).toEqual(audioFade);
  });

  it('emits options.musicVolume + audioFade on an image section', () => {
    const audioFade = { out: { duration: 0.6, curve: 'tri' as const } };
    const state = baseState([
      {
        ...(newSection('image') as Extract<EditorSection, { kind: 'image' }>),
        musicVolume: 0.2,
        audioFade,
      },
    ]);
    const d = buildDescriptor(state);
    const opts = d.sections?.[0].options;

    expect(opts?.musicVolume).toBe(0.2);
    expect(opts?.audioFade).toEqual(audioFade);
  });

  it('round-trips musicVolume + audioFade {in,out,curve} through a stored template', () => {
    const audioFade = {
      in: { duration: 0.5, curve: 'qsin' as const },
      out: { duration: 1.2, curve: 'hsin' as const },
    };
    const state = baseState([
      {
        ...(newSection('video') as Extract<EditorSection, { kind: 'video' }>),
        musicVolume: 0.6,
        audioFade,
      },
    ]);
    const back = toEditorState(asTemplate(state)).sections.find((s) => s.kind === 'video') as Extract<
      EditorSection,
      { kind: 'video' }
    >;

    expect(back.musicVolume).toBe(0.6);
    expect(back.audioFade).toEqual(audioFade);
  });

  it('round-trips audioFade with only an out side (no in)', () => {
    const audioFade = { out: { duration: 0.8 } };
    const state = baseState([
      {
        ...(newSection('color') as Extract<EditorSection, { kind: 'color' }>),
        audioFade,
      },
    ]);
    const back = toEditorState(asTemplate(state)).sections.find((s) => s.kind === 'color') as Extract<
      EditorSection,
      { kind: 'color' }
    >;

    expect(back.audioFade).toEqual(audioFade);
    expect(back.musicVolume).toBeUndefined();
  });

  it('TemplateDescriptorSchema.safeParse passes with musicVolume + audioFade on video/color/image', () => {
    const state = baseState({
      sections: [
        {
          ...(newSection('video') as Extract<EditorSection, { kind: 'video' }>),
          musicVolume: 0.4,
          audioFade: { in: { duration: 0.5, curve: 'qsin' as const }, out: { duration: 0.5 } },
        },
        {
          ...(newSection('color') as Extract<EditorSection, { kind: 'color' }>),
          musicVolume: 0.9,
          audioFade: { out: { duration: 1.0, curve: 'exp' as const } },
        },
        {
          ...(newSection('image') as Extract<EditorSection, { kind: 'image' }>),
          musicVolume: 0.0,
          audioFade: { in: { duration: 0.3 } },
        },
      ],
    });
    const result = TemplateDescriptorSchema.safeParse(buildDescriptor(state));

    expect(result.success).toBe(true);
  });
});

// --- pre-record countdown ---

describe('templateEditorModel — countdown', () => {
  const videoWithCountdown = (countdownSeconds: number): EditorSection => ({
    ...(newSection('video') as Extract<EditorSection, { kind: 'video' }>),
    countdown: true,
    countdownSeconds,
  });

  const projectVideoOptions = (state: EditorState) =>
    buildDescriptor(state).sections?.find((s) => s.type === 'project_video')?.options;

  it('emits countdown + countdownDuration only when the countdown is enabled', () => {
    const options = projectVideoOptions(baseState([videoWithCountdown(5)]));

    expect(options?.countdown).toBe(true);
    expect(options?.countdownDuration).toBe(5);
  });

  it('omits countdown keys when the countdown is disabled', () => {
    const options = projectVideoOptions(baseState([newSection('video')]));

    expect(options?.countdown).toBeUndefined();
    expect(options?.countdownDuration).toBeUndefined();
  });

  it('round-trips an enabled countdown through a stored template', () => {
    const back = toEditorState(asTemplate(baseState([videoWithCountdown(6)]))).sections.find((s) => s.kind === 'video');

    expect(back).toMatchObject({ countdown: true, countdownSeconds: 6 });
  });

  it('rehydrates countdownSeconds to 4 when countdown is set without a duration', () => {
    const template: EditableTemplate = {
      id: 'user-1',
      name: 'T',
      description: '',
      orientation: 'landscape',
      descriptor: { sections: [{ name: 'video_1', type: 'project_video', options: { countdown: true } }] },
    };
    const back = toEditorState(template).sections.find((s) => s.kind === 'video');

    expect(back).toMatchObject({ countdown: true, countdownSeconds: 4 });
  });
});
