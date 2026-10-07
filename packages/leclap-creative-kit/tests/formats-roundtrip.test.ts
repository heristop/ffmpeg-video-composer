// Per-format compositions have no editor controls yet: opening a multi-format template in the builder
// and saving it must keep `formats`, with section patches following the builder's section rename.
import { describe, it, expect } from 'vitest';
import { buildDescriptor, toEditorState, type TemplateDescriptor } from '../src/editor/templateEditorModel';
import { TemplateDescriptorSchema } from 'ffmpeg-video-composer/src/schemas/template.schemas.ts';
import { resolveFormat } from 'ffmpeg-video-composer/src/core/formats/resolve.ts';

const formats = {
  portrait: {
    global: { platform: 'shorts' },
    sections: {
      hook: { kinetic: { byId: { title: { size: 150 } } } },
      end: { remove: true },
    },
  },
  square: { sections: { hook: { options: { duration: 2 } } } },
};

const descriptor = {
  global: { orientation: 'landscape', musicEnabled: false },
  sections: [
    {
      name: 'hook',
      type: 'color_background',
      options: { backgroundColor: '#000000', duration: 3 },
      kinetic: [
        { id: 'title', text: { en: 'Hello' }, preset: 'cascade', size: { $format: { default: 100, portrait: 150 } } },
      ],
    },
    { name: 'end', type: 'color_background', options: { backgroundColor: '#000000', duration: 2 } },
  ],
  formats,
} as unknown as TemplateDescriptor;

function roundTrip(source: TemplateDescriptor): Record<string, any> {
  return buildDescriptor(
    toEditorState({ id: 't', name: 'Formats', description: '', orientation: 'landscape', descriptor: source })
  ) as Record<string, any>;
}

describe('formats round-trip through the editor', () => {
  it('keeps every override, re-keyed to the saved section names, and stays valid in every format', () => {
    const back = roundTrip(descriptor);

    expect(back.sections.map((section: { name: string }) => section.name)).toEqual(['color_1', 'color_2']);
    expect(back.formats).toEqual({
      portrait: {
        global: { platform: 'shorts' },
        sections: { color_1: formats.portrait.sections.hook, color_2: { remove: true } },
      },
      square: { sections: { color_1: { options: { duration: 2 } } } },
    });
    expect(back.sections[0].kinetic).toEqual((descriptor.sections as any)[0].kinetic);
    // `$format` values are only valid once resolved: every format must resolve and parse.
    for (const format of ['landscape', 'portrait', 'square']) {
      const { descriptor: resolved, issues } = resolveFormat(back, format);

      expect(issues).toEqual([]);
      expect(TemplateDescriptorSchema.safeParse(resolved).success).toBe(true);
    }
  });

  it('is stable across a second round trip', () => {
    const once = roundTrip(descriptor);

    expect(roundTrip(once as TemplateDescriptor).formats).toEqual(once.formats);
  });

  it('adds nothing to a template without formats', () => {
    const plain = { ...descriptor, formats: undefined } as TemplateDescriptor;

    expect(roundTrip(plain)).not.toHaveProperty('formats');
  });
});
