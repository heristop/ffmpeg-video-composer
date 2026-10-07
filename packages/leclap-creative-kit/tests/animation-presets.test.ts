import { describe, expect, it } from 'vitest';
import { GraphicSchema, type Graphic } from 'ffmpeg-video-composer/src/schemas/graphics.schemas.ts';
import { TemplateDescriptorSchema } from 'ffmpeg-video-composer/src/schemas/template.schemas.ts';
import { ANIMATION_EFFECT_PRESETS, animationDefaultsForUrl } from '../src/editor/animation-presets';
import {
  buildDescriptor,
  toEditorState,
  newSection,
  makeTemplateId,
  DEFAULT_AUDIO_MIX,
  DEFAULT_TRANSITION,
  type EditorSection,
  type EditorState,
  type Orientation,
} from '../src/editor/templateEditorModel';

const ORIENTATIONS: Orientation[] = ['landscape', 'portrait', 'square'];

// A title card section with a backdrop layer and one card: the recipes should land on the card.
function cardSection(): EditorSection {
  return {
    ...newSection('color'),
    layers: [{ color: '#101418' }, { color: '#2A3140', x: 240, y: 160, w: 800, h: 400, radius: 24 }],
  } as EditorSection;
}

function stateWith(section: EditorSection, orientation: Orientation): EditorState {
  return {
    id: makeTemplateId(),
    name: 'recipes',
    description: '',
    orientation,
    sections: [section],
    globalVariables: [],
    audio: { ...DEFAULT_AUDIO_MIX },
    defaultTransition: { ...DEFAULT_TRANSITION },
    globalAnimations: [],
    globalOverlays: [],
  };
}

describe('bundled animation defaults (legacy samples)', () => {
  it.each(['tap_pulse', 'shine_sweep', 'confetti', 'sparkle'])(
    'plays %s once without retaining its last frame',
    (name) => {
      expect(animationDefaultsForUrl(`/assets/animations/${name}.apng`)).toMatchObject({
        loop: false,
        loops: 1,
        persistent: false,
      });
    }
  );

  it.each(['corner_brackets', 'glow_border'])('keeps %s subtle and aspect preserving', (name) => {
    const defaults = animationDefaultsForUrl(`/assets/animations/${name}.apng`);
    expect(defaults.fit).toBe('contain');
    expect(defaults.opacity).toBeGreaterThan(0);
    expect(defaults.opacity).toBeLessThan(0.6);
    expect(defaults.scale).toBeUndefined();
  });

  it.each([
    'https://example.com/tap_pulse.apng',
    '/custom/tap_pulse.apng',
    'data:image/apng;base64,dGFwX3B1bHNl',
    '/assets/animations/not-bundled.apng',
  ])('leaves custom URL %s unchanged', (url) => {
    expect(animationDefaultsForUrl(url)).toEqual({});
  });

  it('does not share mutable defaults between choices', () => {
    const first = animationDefaultsForUrl('/assets/animations/confetti.apng');
    first.opacity = 0;
    expect(animationDefaultsForUrl('/assets/animations/confetti.apng').opacity).toBeGreaterThan(0);
  });
});

describe('animation effect recipes', () => {
  it('exposes six distinct discoverable recipes', () => {
    expect(ANIMATION_EFFECT_PRESETS.map((preset) => preset.id)).toEqual([
      'interface-focus',
      'product-spotlight',
      'celebration-burst',
      'focus-lock',
      'light-pass',
      'frame-reveal',
    ]);
    for (const preset of ANIMATION_EFFECT_PRESETS) {
      expect(preset.nameKey).toBe(`animation.effects.${preset.id}.name`);
      expect(preset.descriptionKey).toBe(`animation.effects.${preset.id}.description`);
    }
  });

  it.each(ORIENTATIONS)('emits two schema-valid engine graphics per recipe, never an APNG, in %s', (orientation) => {
    for (const section of [newSection('video'), cardSection()]) {
      for (const preset of ANIMATION_EFFECT_PRESETS) {
        const graphics = preset.build({ section, orientation });

        expect(graphics).toHaveLength(2);
        for (const graphic of graphics) {
          expect(GraphicSchema.safeParse(graphic).success, `${preset.id} ${JSON.stringify(graphic)}`).toBe(true);
          expect(JSON.stringify(graphic)).not.toContain('.apng');
        }
      }
    }
  });

  it('anchors every part to the main card of a card section, and to the frame of a video', () => {
    const anchored = (graphic: Graphic) => (graphic as { target?: unknown }).target;

    for (const preset of ANIMATION_EFFECT_PRESETS) {
      const onCard = preset.build({ section: cardSection(), orientation: 'landscape' });
      const onVideo = preset.build({ section: newSection('video'), orientation: 'landscape' });

      for (const graphic of onCard) {
        if (graphic.type === 'fx' && graphic.effect === 'leak') continue;

        expect(anchored(graphic), preset.id).toBe('layer:1');
      }
      for (const graphic of onVideo) {
        if (graphic.type === 'fx') expect(anchored(graphic)).toBe('frame');
      }
    }
  });

  it('pairs interface brackets with a tap ripple and a product sheen with an orbiting glint', () => {
    const build = (id: string) =>
      ANIMATION_EFFECT_PRESETS.find((preset) => preset.id === id)!.build({
        section: cardSection(),
        orientation: 'landscape',
      }) as Array<Record<string, unknown>>;

    expect(build('interface-focus').map((g) => [g.type, g.effect, g.variant])).toEqual([
      ['corners', undefined, undefined],
      ['fx', 'ripple', 'tap'],
    ]);
    expect(build('product-spotlight').map((g) => [g.effect, g.path])).toEqual([
      ['sheen', undefined],
      ['glint', 'orbit'],
    ]);
  });

  it('gives each part of a recipe its own seed, and the parts land in order', () => {
    for (const preset of ANIMATION_EFFECT_PRESETS) {
      const [first, second] = preset.build({ section: cardSection(), orientation: 'portrait' }) as Array<{
        at?: number;
        seed?: number;
      }>;

      expect(second.at ?? 0).toBeGreaterThan(first.at ?? 0);
      if (first.seed !== undefined && second.seed !== undefined) expect(first.seed).not.toBe(second.seed);
    }
  });

  it('returns independent graphics for each application', () => {
    const preset = ANIMATION_EFFECT_PRESETS[0];
    const first = preset.build({ section: newSection('video'), orientation: 'square' });
    (first[0] as { at?: number }).at = 9;
    const fresh = preset.build({ section: newSection('video'), orientation: 'square' });
    expect((fresh[0] as { at?: number }).at).not.toBe(9);
  });

  it.each(ORIENTATIONS)('round-trips every recipe through the builder model unchanged in %s', (orientation) => {
    for (const preset of ANIMATION_EFFECT_PRESETS) {
      const card = cardSection();
      const graphics = preset.build({ section: card, orientation });
      const state = stateWith({ ...card, graphics } as EditorSection, orientation);
      const descriptor = buildDescriptor(state);
      const restored = toEditorState({ id: state.id, name: state.name, description: '', orientation, descriptor });
      const again = buildDescriptor(restored);

      expect(TemplateDescriptorSchema.safeParse(descriptor).success).toBe(true);
      expect((restored.sections[0] as { graphics?: Graphic[] }).graphics).toEqual(graphics);
      expect(again).toEqual(descriptor);
    }
  });
});
