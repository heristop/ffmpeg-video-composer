import { describe, expect, it } from 'vitest';
import { STARTER_PRESETS, addSection, buildDescriptor, patch, patchSection } from '@leclap/creative-kit/editor';
import { droppedPointers, rehydrate, reuseUnchanged, stableKey } from './apply-descriptor';

describe('apply-descriptor helpers', () => {
  it('stableKey ignores key order', () => {
    expect(stableKey({ b: 1, a: { d: 2, c: [1, { y: 1, x: 2 }] } })).toBe(
      stableKey({ a: { c: [1, { x: 2, y: 1 }], d: 2 }, b: 1 })
    );
  });

  it('the builder round trip of its own descriptor is lossless', () => {
    for (const preset of STARTER_PRESETS) {
      const state = preset.build();
      const descriptor = buildDescriptor(state);

      expect(droppedPointers(descriptor, buildDescriptor(rehydrate(descriptor, state)))).toEqual([]);
    }
  });

  it('an agent descriptor with an HTML layer round-trips through the builder whole', () => {
    const state = STARTER_PRESETS[0].build();
    const descriptor = buildDescriptor(state);
    const sections = descriptor.sections ?? [];
    const index = sections.findIndex((section) => section.type === 'color_background');
    const card = {
      name: 'price_tag',
      type: 'html' as const,
      html: '<div class="tag">{{ price }}</div>',
      css: '.tag { padding: 12px; color: $color.fg }',
      width: 320,
      height: 96,
      options: { position: '64:64', start: 0.4, motion: { type: 'rise' as const, duration: 0.5 } },
    };
    const withCard = {
      ...descriptor,
      sections: sections.map((section, i) => (i === index ? { ...section, inputs: [card] } : section)),
    };

    expect(index).toBeGreaterThanOrEqual(0);
    expect(droppedPointers(withCard, buildDescriptor(rehydrate(withCard, state)))).toEqual([]);
  });

  it('droppedPointers names leaves that did not survive, never builder-assigned section names', () => {
    expect(
      droppedPointers(
        { global: { fps: 30, orientation: 'portrait' }, sections: [{ name: 'intro', type: 'form' }] },
        { global: { orientation: 'portrait' }, sections: [{ name: 'form_1', type: 'form' }] }
      )
    ).toEqual(['/global/fps']);
  });

  it('reuseUnchanged keeps untouched sections (music fold included) and reports changed positions', () => {
    const prev = addSection(STARTER_PRESETS[0].build(), 'music');
    const reordered = { ...prev, sections: [prev.sections[0], prev.sections[3], prev.sections[1], prev.sections[2]] };
    const next = rehydrate(buildDescriptor(patch(reordered, { name: 'Changed' })), reordered);
    const edited = { ...next, sections: next.sections.map((section, i) => (i === 2 ? { ...section } : section)) };
    const { state, changed } = reuseUnchanged(reordered, edited);

    expect(changed).toEqual([]);
    // An empty music section has no descriptor form: it is put back where the user had it.
    expect(state.sections.map((section) => section.kind)).toEqual(['color', 'music', 'video', 'color']);
    expect(state.sections[1]).toBe(reordered.sections[1]);
    // The draft's own objects come back, editor-only fields (not in the descriptor) included.
    expect(state.sections[2]).toBe(prev.sections[1]);
    expect(state.sections.every((section) => reordered.sections.includes(section))).toBe(true);
    expect(state.name).toBe('Changed');
    expect(state.id).toBe(reordered.id);
  });

  it('a configured music section folds to the front and is reused', () => {
    const base = addSection(STARTER_PRESETS[0].build(), 'music');
    const prev = patchSection(base, 3, { allowed: ['track.mp3'] });
    const next = rehydrate(buildDescriptor(prev), prev);
    const { state, changed } = reuseUnchanged(prev, next);

    expect(changed).toEqual([]);
    expect(state.sections[0]).toBe(prev.sections[3]);
  });
});
