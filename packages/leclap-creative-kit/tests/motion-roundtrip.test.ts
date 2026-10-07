// Motion fields with no editor controls yet must be carried through untouched:
// opening a template in the builder and saving it may never strip its kinetic type, camera, graphics,
// subtitles, caption wrapping, designed transition easing, seed, motion tokens or theme.
import { describe, it, expect } from 'vitest';
import { buildDescriptor, toEditorState, type TemplateDescriptor } from '../src/editor/templateEditorModel';
import { TemplateDescriptorSchema } from 'ffmpeg-video-composer/src/schemas/template.schemas.ts';

const descriptor = {
  meta: { name: 'Motion' },
  global: {
    orientation: 'landscape',
    musicEnabled: false,
    seed: 42,
    motion: { energy: 0.8, curves: { brand: 'ease-out-expo' } },
    theme: { extends: 'midnight', colors: { accent: '#ff2e4d' }, motion: { ease: '$snappy' } },
    transition: { type: 'push-left', duration: 0.6, ease: '$snappy' },
  },
  sections: [
    {
      name: 'hook',
      type: 'color_background',
      options: { backgroundColor: '$color.bg', duration: 3 },
      kinetic: [{ text: { en: 'Make it land.' }, preset: 'cascade', accent: { words: 'last' } }],
      camera: { preset: 'push-in', hits: [0.6] },
      graphics: [{ type: 'flash', at: 0.6 }],
      subtitles: {
        style: 'loud',
        karaoke: 'pop',
        crown: 'auto',
        group: { maxWords: 3 },
        words: [
          { text: 'Make', start: 0.2, end: 0.5 },
          { text: 'it', start: 0.55, end: 0.7 },
          { text: 'land.', start: 0.75, end: 1.2 },
        ],
      },
      caption: { text: { en: 'A long caption that wraps' }, wrap: 'balanced', fit: { minSize: 30 } },
      transition: { type: 'zoom-through', duration: 0.7, ease: '$brand' },
    },
    { name: 'end', type: 'color_background', options: { backgroundColor: '#000000', duration: 2 } },
  ],
} as unknown as TemplateDescriptor;

describe('motion round-trip through the editor', () => {
  it('keeps every motion field and stays schema-valid', () => {
    const state = toEditorState({ id: 't', name: 'Motion', description: '', orientation: 'landscape', descriptor });
    const back = buildDescriptor(state) as Record<string, any>;

    expect(back.global.seed).toBe(42);
    expect(back.global.motion).toEqual({ energy: 0.8, curves: { brand: 'ease-out-expo' } });
    expect(back.global.theme).toEqual(descriptor.global?.theme);
    expect(back.sections[0].options.backgroundColor).toBe('$color.bg');
    expect(back.global.transition).toEqual({ type: 'push-left', duration: 0.6, ease: '$snappy' });
    expect(back.sections[0].kinetic).toEqual((descriptor.sections as any)[0].kinetic);
    expect(back.sections[0].camera).toEqual({ preset: 'push-in', hits: [0.6] });
    expect(back.sections[0].graphics).toEqual([{ type: 'flash', at: 0.6 }]);
    expect(back.sections[0].subtitles).toEqual((descriptor.sections as any)[0].subtitles);
    expect(back.sections[0].caption).toMatchObject({ wrap: 'balanced', fit: { minSize: 30 } });
    expect(back.sections[0].transition).toEqual({ type: 'zoom-through', duration: 0.7, ease: '$brand' });
    expect(TemplateDescriptorSchema.safeParse(back).success).toBe(true);
  });

  it('adds nothing to a template without motion settings', () => {
    const plain = { global: { orientation: 'landscape' }, sections: [] } as unknown as TemplateDescriptor;
    const back = buildDescriptor(
      toEditorState({ id: 't', name: 'T', description: '', orientation: 'landscape', descriptor: plain })
    );

    expect(back.global).not.toHaveProperty('seed');
    expect(back.global).not.toHaveProperty('motion');
    expect(back.global).not.toHaveProperty('theme');
  });

  it('keeps a built-in theme name', () => {
    const named = {
      global: { orientation: 'landscape', theme: 'neon' },
      sections: [],
    } as unknown as TemplateDescriptor;
    const back = buildDescriptor(
      toEditorState({ id: 't', name: 'T', description: '', orientation: 'landscape', descriptor: named })
    );

    expect(back.global?.theme).toBe('neon');
  });
});
