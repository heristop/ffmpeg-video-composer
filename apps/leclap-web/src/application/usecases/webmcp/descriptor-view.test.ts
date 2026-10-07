import { describe, expect, it } from 'vitest';
import { templateRevision } from 'ffmpeg-video-composer/src/core/determinism/template-revision.ts';
import { STARTER_PRESETS, addSection, buildDescriptor } from '@leclap/creative-kit/editor';
import {
  escapePointerSegment,
  nameAt,
  positionOfName,
  redactDescriptor,
  revisionOf,
  sectionInventory,
  textSlots,
} from './descriptor-view';

describe('descriptor view', () => {
  it('uses the shared engine revision', () => {
    const descriptor = buildDescriptor(STARTER_PRESETS[0].build());

    expect(revisionOf(descriptor)).toBe(templateRevision(descriptor as unknown as Record<string, unknown>));
  });

  it('redacts upload labels and blob/data URLs, keeping media:// keys opaque', () => {
    const redacted = redactDescriptor({
      a: { url: 'media://k1', label: 'passport.jpg' },
      b: 'blob:https://x/1',
      c: ['data:image/png;base64,AAA', 'library://logo'],
      d: { url: 'https://leclap.test/x.png', label: 'kept' },
    });

    expect(redacted).toEqual({
      a: { url: 'media://k1', label: 'user upload' },
      b: '[redacted]',
      c: ['[redacted]', 'library://logo'],
      d: { url: 'https://leclap.test/x.png', label: 'kept' },
    });
  });

  it('finds on-screen copy, including translation maps, as JSON Pointers', () => {
    const slots = textSlots(
      {
        titleCard: { headline: { en: 'Hi', fr: 'Salut' }, accent: '#fff' },
        filters: [{ type: 'drawtext', values: { text: { en: 'Caption' }, fontcolor: 'white' } }],
        options: { fields: [{ name: 'first_name', label: { en: 'Your name' } }] },
        'a/b': { text: 'x' },
      },
      '/sections/0'
    );

    expect(slots).toEqual([
      { pointer: '/sections/0/titleCard/headline/en', role: 'headline', value: 'Hi' },
      { pointer: '/sections/0/titleCard/headline/fr', role: 'headline', value: 'Salut' },
      { pointer: '/sections/0/filters/0/values/text/en', role: 'text', value: 'Caption' },
      { pointer: '/sections/0/options/fields/0/label/en', role: 'label', value: 'Your name' },
      { pointer: '/sections/0/a~1b/text', role: 'text', value: 'x' },
    ]);
    expect(escapePointerSegment('a~/b')).toBe('a~0~1b');
  });

  it('maps names and positions across the music fold', () => {
    const state = addSection(STARTER_PRESETS[0].build(), 'music');
    const inventory = sectionInventory(state, []);

    expect(inventory.map((section) => section.position)).toEqual([0, 1, 2, 3]);
    expect(positionOfName(state, 'color_2')).toBe(2);
    expect(positionOfName(state, 'nope')).toBeNull();
    expect(nameAt(state, 3)).toBe('music');
    expect(nameAt(state, 1)).toBe('video_1');
    expect(inventory[1]).toMatchObject({
      start: expect.any(Number),
      end: expect.any(Number),
      transition: { type: 'fade' },
    });
  });
});
