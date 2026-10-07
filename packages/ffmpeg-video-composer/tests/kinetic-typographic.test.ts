import { describe, expect, it } from 'vitest';
import { kineticToFilters } from '@/editor/presets/kinetic';
import { KineticBlockSchema } from '@/schemas/kinetic.schemas';
import { TemplateValidator } from '@/services/TemplateValidator';
import type { TemplateDescriptor } from '@/core/types';

// Copy pasted from a word processor carries typographic punctuation: a curly apostrophe, curly quotes, an
// em dash. The bundled advance tables measure it, so a kinetic block lays it out instead of drawing
// nothing; a character a font really lacks is reported by validation rather than dropped in silence.

const FRAME = { width: 1280, height: 720, fps: 30, duration: 3, seed: 7, energy: 1 };

function drawn(text: string, preset: 'rise' | 'typewriter', font?: string): string[] {
  const block = KineticBlockSchema.parse({ text: { en: text }, preset, ...(font ? { font } : {}) });

  return kineticToFilters(block, { ...FRAME, text })
    .filter((filter) => filter.type === 'drawtext')
    .map((filter) => String((filter.values as Record<string, unknown>).text));
}

function template(text: string): TemplateDescriptor {
  return {
    global: { orientation: 'landscape' },
    sections: [
      {
        name: 's',
        type: 'color_background',
        options: { backgroundColor: '#000', duration: 3 },
        kinetic: [{ text: { en: text }, preset: 'rise' }],
      },
    ],
  } as unknown as TemplateDescriptor;
}

describe('kinetic copy with typographic punctuation', () => {
  it('lays out a curly apostrophe like a straight one, word by word', () => {
    expect(drawn('It’s here', 'rise')).toEqual(['It’s', 'here']);
    expect(drawn("It's here", 'rise')).toEqual(["It's", 'here']);
  });

  it('lays out curly quotes and an em dash, glyph by glyph too', () => {
    expect(drawn('“Hi” — ok', 'rise')).toEqual(['“Hi”', '—', 'ok']);
    expect(drawn('“Hi”', 'typewriter')).toEqual(['“', 'H', 'i', '”']);
    expect(drawn('Don’t stop', 'rise', 'oswald')).toEqual(['Don’t', 'stop']);
  });

  it('validates the punctuation cleanly and reports a character the font has no glyph for', () => {
    const errors = (copy: string) =>
      (new TemplateValidator().validateTemplate(template(copy)).errors ?? []).map((error) => error.code);

    expect(errors('It’s “here” — now…')).not.toContain('kinetic_glyph_unmeasurable');
    expect(errors('Go 中 now')).toContain('kinetic_glyph_unmeasurable');
  });
});
