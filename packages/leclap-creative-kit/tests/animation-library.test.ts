import { describe, expect, it } from 'vitest';
import { GraphicSchema, type Graphic } from 'ffmpeg-video-composer/src/schemas/graphics.schemas.ts';
import { FX_PRIMITIVES } from 'ffmpeg-video-composer/src/schemas/fx-primitives.schemas.ts';
import {
  ANIMATION_GROUPS,
  ENGINE_LIBRARY,
  engineEntriesIn,
  legacyEquivalent,
  libraryEntryOfGraphic,
  libraryLabelKey,
  sampleEntries,
} from '../src/editor/animation-library';
import { draftGraphic, mainLayerTarget } from '../src/editor/fx-draft';
import {
  fxTargetOptions,
  isTunableGraphic,
  ownParamFields,
  sharedParamFields,
  withParam,
} from '../src/editor/fx-params';
import { TemplateValidator } from 'ffmpeg-video-composer';
import {
  buildDescriptor,
  DEFAULT_AUDIO_MIX,
  DEFAULT_TRANSITION,
  newSection,
  type EditorSection,
  type Orientation,
} from '../src/editor/templateEditorModel';

const FILES = [
  'animation_icons.apng',
  'confetti.apng',
  'corner_brackets.apng',
  'glow_border.apng',
  'light_leak.apng',
  'pulse_ring.apng',
  'rounded_border.apng',
  'shine_sweep.apng',
  'sparkle.apng',
  'spec_orbit.apng',
  'tap_pulse.apng',
  'white_border.apng',
];

function cardSection(layers: Array<Record<string, unknown>>): EditorSection {
  return { ...newSection('color'), layers } as EditorSection;
}

describe('animation library', () => {
  it('offers every fx primitive, plus the frame, corners and underline strokes, in the engine groups', () => {
    const effects = new Set(
      ENGINE_LIBRARY.flatMap((entry) => (entry.preset.type === 'fx' ? [entry.preset.effect] : []))
    );

    expect([...effects].toSorted()).toEqual(Object.keys(FX_PRIMITIVES).toSorted());
    expect(engineEntriesIn('frames').map((entry) => entry.id)).toEqual(['frame', 'corners', 'underline']);
    expect(new Set(ENGINE_LIBRARY.map((entry) => entry.id)).size).toBe(ENGINE_LIBRARY.length);
    for (const entry of ENGINE_LIBRARY) expect(ANIMATION_GROUPS).toContain(entry.group);
    expect(libraryLabelKey('sheen')).toBe('animation.library.sheen');
  });

  it('lists the legacy APNGs as samples, hiding animation icons and the spec orbit', () => {
    const samples = sampleEntries(FILES);

    expect(samples.map((sample) => sample.id)).not.toContain('animation-icons');
    expect(samples.map((sample) => sample.id)).not.toContain('spec-orbit');
    expect(samples).toHaveLength(10);
    for (const sample of samples) {
      expect(sample.group).toBe('samples');
      expect(ENGINE_LIBRARY.map((entry) => entry.id)).toContain(sample.equivalent);
    }
  });

  it.each([
    ['/assets/animations/shine_sweep.apng', 'sheen'],
    ['/assets/animations/spec_orbit.apng', 'glint-orbit'],
    ['animations/sparkle.apng', 'glint'],
    ['/assets/animations/tap_pulse.apng', 'ripple-tap'],
    ['/assets/animations/rounded_border.apng', 'frame'],
  ])('maps the legacy %s to the %s primitive', (url, id) => {
    expect(legacyEquivalent(url)?.id).toBe(id);
  });

  it('has no equivalent for unknown or custom animations', () => {
    expect(legacyEquivalent('/assets/animations/animation_icons.apng')).toBeUndefined();
    expect(legacyEquivalent('data:image/apng;base64,AAAA')).toBeUndefined();
  });

  it('reads a graphic back as its library card', () => {
    const read = (graphic: Record<string, unknown>) => libraryEntryOfGraphic(graphic as Graphic)?.id;

    expect(read({ type: 'fx', effect: 'glint', path: 'orbit' })).toBe('glint-orbit');
    expect(read({ type: 'fx', effect: 'glint', path: 'corners' })).toBe('glint');
    expect(read({ type: 'fx', effect: 'ripple', variant: 'tap' })).toBe('ripple-tap');
    expect(read({ type: 'fx', effect: 'ripple' })).toBe('ripple');
    expect(read({ type: 'corners', inset: 40 })).toBe('corners');
    expect(read({ type: 'flash' })).toBeUndefined();
  });
});

describe('library placements (fx-draft)', () => {
  const orientations: Orientation[] = ['landscape', 'portrait', 'square'];

  it.each(orientations)('drafts a schema-valid, tuned graphic for every entry in %s', (orientation) => {
    const sections = [newSection('video'), cardSection([{ color: '#000' }, { x: 100, y: 80, w: 400, h: 300 }])];

    for (const section of sections) {
      for (const entry of ENGINE_LIBRARY) {
        const graphic = draftGraphic(entry, { section, orientation });
        const keys = Object.keys(graphic).filter((key) => !['type', 'effect', 'target'].includes(key));

        expect(GraphicSchema.safeParse(graphic).success, `${entry.id}: ${JSON.stringify(graphic)}`).toBe(true);
        // Context-derived parameters, never a bare default placement.
        expect(keys.length, entry.id).toBeGreaterThan(1);
      }
    }
  });

  it('passes the engine validator with every entry placed on a card and on a video', () => {
    const card = cardSection([{ color: '#000' }, { x: 100, y: 80, w: 400, h: 300 }]);
    const withAll = (section: EditorSection) =>
      ({
        ...section,
        graphics: ENGINE_LIBRARY.map((entry) => draftGraphic(entry, { section, orientation: 'landscape' })).slice(
          0,
          24
        ),
      }) as EditorSection;
    const descriptor = buildDescriptor({
      id: 't',
      name: 'library',
      description: '',
      orientation: 'landscape',
      sections: [withAll(card), withAll({ ...newSection('video'), duration: 6 } as EditorSection)],
      globalVariables: [],
      audio: { ...DEFAULT_AUDIO_MIX },
      defaultTransition: { ...DEFAULT_TRANSITION },
      globalAnimations: [],
      globalOverlays: [],
    });
    const validator = new TemplateValidator();
    const result = validator.validateTemplate(descriptor);

    expect(result.success, validator.getValidationSummary(result)).toBe(true);
  });

  it('lands subject effects on the largest card and ambient ones on the frame', () => {
    const section = cardSection([
      { color: '#000' },
      { x: 40, y: 40, w: 120, h: 80 },
      { x: 300, y: 200, w: 600, h: 300, radius: 20 },
      { x: 'iw*0.1', y: 0, w: 10, h: 10 },
    ]);
    const sheen = ENGINE_LIBRARY.find((entry) => entry.id === 'sheen')!;
    const grain = ENGINE_LIBRARY.find((entry) => entry.id === 'grain')!;

    expect(mainLayerTarget(section, 'landscape')?.target).toBe('layer:2');
    expect(draftGraphic(sheen, { section, orientation: 'landscape' })).toMatchObject({ target: 'layer:2' });
    expect(draftGraphic(grain, { section, orientation: 'landscape' })).toMatchObject({ target: 'frame', at: 0 });
    expect(mainLayerTarget(newSection('video'), 'landscape')).toBeNull();
  });

  it('seeds each placement from its context, so repeated picks differ', () => {
    const sheen = ENGINE_LIBRARY.find((entry) => entry.id === 'sheen')!;
    const section = newSection('video');
    const first = draftGraphic(sheen, { section, orientation: 'landscape' }) as { seed: number };
    const second = draftGraphic(sheen, {
      section: { ...section, graphics: [first as Graphic] } as EditorSection,
      orientation: 'landscape',
    }) as { seed: number };
    const elsewhere = draftGraphic(sheen, { section, orientation: 'landscape', salt: 3 }) as { seed: number };

    expect(second.seed).not.toBe(first.seed);
    expect(elsewhere.seed).not.toBe(first.seed);
    expect(draftGraphic(sheen, { section, orientation: 'landscape' })).toEqual(first);
  });

  it('runs a sheen along the long side of its target', () => {
    const sheen = ENGINE_LIBRARY.find((entry) => entry.id === 'sheen')!;
    const tall = cardSection([{ color: '#000' }, { x: 100, y: 100, w: 200, h: 500 }]);

    expect(draftGraphic(sheen, { section: tall, orientation: 'portrait' })).toMatchObject({ direction: 'down' });
    expect(draftGraphic(sheen, { section: newSection('video'), orientation: 'landscape' })).toMatchObject({
      direction: 'right',
    });
  });
});

describe('parameter panel fields (fx-params)', () => {
  it('derives every own field of a primitive from its schema', () => {
    const fields = ownParamFields({ type: 'fx', effect: 'sheen' } as Graphic);

    expect(fields.map((field) => field.key)).toEqual(['profile', 'width', 'tilt', 'direction', 'bloom']);
    expect(fields.find((field) => field.key === 'width')).toMatchObject({ kind: 'number', min: 0.02, max: 0.6 });
    expect(fields.find((field) => field.key === 'profile')).toMatchObject({
      kind: 'enum',
      options: ['specular', 'soft', 'twin'],
    });
  });

  it('reads theme-token colours, booleans and integers', () => {
    expect(ownParamFields({ type: 'fx', effect: 'edge-glow' } as Graphic).find((f) => f.key === 'glow')?.kind).toBe(
      'color'
    );
    expect(ownParamFields({ type: 'fx', effect: 'grain' } as Graphic).find((f) => f.key === 'animated')?.kind).toBe(
      'boolean'
    );
    expect(ownParamFields({ type: 'fx', effect: 'ripple' } as Graphic).find((f) => f.key === 'rings')).toMatchObject({
      kind: 'number',
      step: 1,
    });
  });

  it('lists the v2 stroke fields of frame, corners and underline without their shared timing', () => {
    const corners = ownParamFields({ type: 'corners' } as Graphic).map((field) => field.key);

    expect(corners).toEqual(expect.arrayContaining(['length', 'thickness', 'trace', 'exit', 'spread', 'clearance']));
    expect(corners).not.toContain('at');
    expect(corners).not.toContain('target');
    expect(ownParamFields({ type: 'underline' } as Graphic).map((field) => field.key)).toContain('caps');
    expect(sharedParamFields({ type: 'frame' } as Graphic).map((field) => field.key)).toEqual([
      'at',
      'duration',
      'color',
    ]);
  });

  it('knows which graphics it can edit, the targets a section offers, and clears a parameter', () => {
    expect(isTunableGraphic({ type: 'fx', effect: 'dust' } as Graphic)).toBe(true);
    expect(isTunableGraphic({ type: 'flash' } as Graphic)).toBe(false);
    expect(fxTargetOptions(cardSection([{ color: '#000' }, { x: 0, y: 0, w: 10, h: 10 }]))).toEqual([
      'frame',
      'layer:0',
      'layer:1',
    ]);
    expect(fxTargetOptions(newSection('video'))).toEqual(['frame']);
    expect(withParam({ type: 'fx', effect: 'sheen', tilt: 12 } as Graphic, 'tilt', undefined)).toEqual({
      type: 'fx',
      effect: 'sheen',
    });
  });
});
