import { describe, expect, it } from 'vitest';
import { ANIMATION_EFFECT_PRESETS, animationDefaultsForUrl } from '../src/editor/animation-presets';
import {
  buildDescriptor,
  toEditorState,
  newSection,
  makeTemplateId,
  DEFAULT_AUDIO_MIX,
  DEFAULT_TRANSITION,
  type EditorState,
  type Orientation,
} from '../src/editor/templateEditorModel';

const frames: Record<Orientation, [number, number]> = {
  landscape: [1280, 720],
  portrait: [720, 1280],
  square: [1080, 1080],
};

const nativeAspects: Record<string, number> = {
  corner_brackets: 1280 / 720,
  shine_sweep: 1280 / 720,
  confetti: 1280 / 720,
  sparkle: 1280 / 720,
  tap_pulse: 1,
  spec_orbit: 720 / 1280,
  pulse_ring: 1280 / 720,
  light_leak: 1280 / 720,
  white_border: 1280 / 720,
};

describe('bundled animation defaults', () => {
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

describe('animation effect presets', () => {
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

  it.each(Object.keys(frames) as Orientation[])(
    'fits finite overlays inside the %s frame without distorting artwork',
    (orientation) => {
      const [frameW, frameH] = frames[orientation];
      for (const preset of ANIMATION_EFFECT_PRESETS) {
        const layers = preset.build(orientation);
        expect(layers.length).toBeGreaterThan(0);
        expect(layers.length).toBeLessThanOrEqual(2);
        for (const layer of layers) {
          const [w, h] = layer.scale!.split(':').map(Number);
          const [x, y] = layer.position!.split(':').map(Number);
          const filename = layer.url.split('/').at(-1)!.replace('.apng', '');
          expect(w / h).toBeCloseTo(nativeAspects[filename], 2);
          expect(layer.fit).toBe('contain');
          expect(x).toBeGreaterThanOrEqual(0);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(x + w).toBeLessThanOrEqual(frameW);
          expect(y + h).toBeLessThanOrEqual(frameH);
          expect(layer.persistent).toBe(false);
          expect(layer.duration).toBeGreaterThan(0);
          expect(layer.duration).toBeLessThanOrEqual(3);
          expect(layer.loop).toBeUndefined();
          expect(layer.loops).toBeUndefined();
        }
      }
    }
  );

  it('pairs interface brackets with a centered focus pulse and a product orbit with its sweep', () => {
    const focus = ANIMATION_EFFECT_PRESETS.find((preset) => preset.id === 'interface-focus')!.build('landscape');
    expect(focus.map((layer) => layer.url)).toEqual([
      '/assets/animations/corner_brackets.apng',
      '/assets/animations/tap_pulse.apng',
    ]);
    const [tapW, tapH] = focus[1].scale!.split(':').map(Number);
    const [tapX, tapY] = focus[1].position!.split(':').map(Number);
    expect(Math.abs(tapX + tapW * 0.5 - 640)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(tapY + tapH * 0.6 - 720 * 0.52)).toBeLessThanOrEqual(0.5);
    const spotlight = ANIMATION_EFFECT_PRESETS.find((preset) => preset.id === 'product-spotlight')!.build('landscape');
    expect(spotlight.map((layer) => layer.url)).toContain('/assets/animations/spec_orbit.apng');
  });

  it('returns independent layers for each application', () => {
    const preset = ANIMATION_EFFECT_PRESETS[0];
    const first = preset.build('square');
    first[0].opacity = 0;
    first.push({ url: '/custom.apng' });
    const fresh = preset.build('square');
    expect(fresh[0].opacity).toBeGreaterThan(0);
    expect(fresh).toHaveLength(2);
  });

  it.each(Object.keys(frames) as Orientation[])(
    'retains preset timing and geometry through JSON editor round-trip in %s',
    (orientation) => {
      for (const preset of ANIMATION_EFFECT_PRESETS) {
        const layers = preset.build(orientation);
        const state: EditorState = {
          id: makeTemplateId(),
          name: preset.id,
          description: '',
          orientation,
          sections: [newSection('video')],
          globalVariables: [],
          audio: { ...DEFAULT_AUDIO_MIX },
          defaultTransition: { ...DEFAULT_TRANSITION },
          globalAnimations: layers,
          globalOverlays: [],
        };
        const descriptor = buildDescriptor(state);
        const restored = toEditorState({
          id: state.id,
          name: state.name,
          description: state.description,
          orientation,
          descriptor,
        });
        expect(restored.globalAnimations).toHaveLength(layers.length);
        for (let index = 0; index < layers.length; index++) {
          const { label: _label, id: _id, ...portable } = layers[index];
          expect(restored.globalAnimations[index]).toMatchObject(portable);
        }
      }
    }
  );
});
