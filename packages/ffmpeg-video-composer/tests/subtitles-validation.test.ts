import { describe, expect, it } from 'vitest';
import { TemplateValidator } from '@/services/TemplateValidator';
import { validateGlyphCoverage } from '@/services/glyph-coverage';
import { resolveTimeRefs } from '@/core/timing/resolve';
import type { TemplateDescriptor } from '@/schemas/template.schemas';
import { kineticToFilters } from '@/editor/presets/kinetic';
import { KineticBlockSchema } from '@/schemas/kinetic.schemas';
import { captionToFilters } from '@/editor/presets/captions';
import { measureText } from '@/core/captions/wrap';

function template(subtitles: unknown, extra: Record<string, unknown> = {}): TemplateDescriptor {
  return {
    global: { orientation: 'landscape', musicEnabled: false },
    sections: [
      {
        name: 'talk',
        type: 'color_background',
        options: { backgroundColor: '#000000', duration: 3 },
        subtitles,
        ...extra,
      },
    ],
  } as unknown as TemplateDescriptor;
}

function codes(descriptor: TemplateDescriptor): string[] {
  return (new TemplateValidator().validateTemplate(descriptor).errors ?? []).map((error) => error.code);
}

function warnings(descriptor: TemplateDescriptor) {
  return new TemplateValidator().getMotionWarnings(descriptor);
}

describe('subtitle validation', () => {
  it('accepts a well-formed track', () => {
    expect(codes(template({ words: [{ text: 'Hi', start: 0, end: 0.4 }] }))).toEqual([]);
  });

  it('reports SRT blocks it cannot read', () => {
    const errors = new TemplateValidator().validateTemplate(template({ srt: '1\nsoon\nHello' })).errors ?? [];

    expect(errors).toEqual([
      expect.objectContaining({
        code: 'invalid_srt',
        path: 'sections[0].subtitles.srt',
        message: expect.stringMatching(/^line 1:/),
      }),
    ]);
  });

  it('reports words out of order or overlapping, and inverted cues', () => {
    const words = [
      { text: 'b', start: 1, end: 1.5 },
      { text: 'a', start: 0.2, end: 0.6 },
      { text: 'c', start: 2, end: 1.8 },
    ];

    expect(codes(template({ words }))).toEqual(['invalid_word_timings', 'invalid_word_timings']);
    expect(codes(template({ cues: [{ at: 2, end: 1, text: 'x' }] }))).toEqual(['invalid_subtitle_cue']);
  });

  it('rejects a font override that is not bundled', () => {
    expect(codes(template({ words: [{ text: 'Hi', start: 0, end: 1 }], font: 'Custom.ttf' }))).toContain(
      'subtitle_font_unmeasurable'
    );
  });

  it('checks glyph coverage of every subtitle string', () => {
    const findings = validateGlyphCoverage(template({ cues: [{ at: 0, end: 1, text: { en: 'Hi 漢字' } }] }));

    expect(findings[0]).toMatchObject({ code: 'font_missing_glyphs', path: 'sections[0].subtitles.cues[0].text.en' });
    expect(findings[0].hint).toMatch(/Subtitles are laid out with a bundled font/);
  });

  it('resolves cue times given as time references', () => {
    const resolved = resolveTimeRefs(
      template({ cues: [{ at: 'cue:hello', end: 'end - 0.5', text: 'Hi' }] }, { cues: { hello: 0.4 } })
    ).descriptor;
    const cue = (resolved.sections as Array<{ subtitles: { cues: Array<{ at: number; end: number }> } }>)[0].subtitles
      .cues[0];

    expect(cue).toMatchObject({ at: 0.4, end: 2.5 });
  });
});

describe('subtitle advisories', () => {
  it('warns when cues run past the section end', () => {
    const found = warnings(template({ cues: [{ at: 2, end: 4.5, text: 'Late' }] }));

    expect(found).toEqual([expect.objectContaining({ code: 'subtitle_past_end', severity: 'warn' })]);
  });

  it('reports split and shrunk cues as info', () => {
    const long = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen';
    const found = warnings(template({ cues: [{ at: 0, end: 3, text: long }], maxLines: 1, size: 60, minSize: 50 }));

    expect(found.map((w) => [w.code, w.severity])).toEqual(
      expect.arrayContaining([
        ['caption_split', 'info'],
        ['caption_shrunk', 'info'],
      ])
    );
  });

  it('warns when more than one section crowns a line', () => {
    const descriptor = {
      sections: [0, 1].map((i) => ({
        name: `s${i}`,
        type: 'color_background',
        options: { duration: 2 },
        subtitles: { cues: [{ at: 0, end: 1, text: 'Yes!' }], crown: 'auto' },
      })),
    };

    expect(warnings(descriptor as unknown as TemplateDescriptor).map((w) => w.code)).toContain(
      'caption_crown_repeated'
    );
  });
});

describe('balanced wrap opt-ins', () => {
  const resolveText = (text: Record<string, string | undefined>) => text.en ?? '';
  const motion = { energy: 1, seedFor: () => 1, resolveText };

  it('caption without wrap/fit stays one drawtext (goldens unchanged)', () => {
    const filters = captionToFilters({ text: { en: 'A long caption for the frame' } }, { scale: '1280:720', motion });

    expect(filters).toHaveLength(1);
    expect(filters[0].values?.text).toEqual({ en: 'A long caption for the frame' });
  });

  it('caption wrap balanced + fit draws one shrunk drawtext per line on a shared baseline', () => {
    const text = 'Every caption should read in one breath, never ending a line on the word the';
    const filters = captionToFilters(
      { text: { en: text }, style: 'subtle', wrap: 'balanced', fit: { minSize: 30, maxLines: 2 } },
      { scale: '1280:720', motion }
    );

    expect(filters.length).toBe(2);
    for (const filter of filters) {
      expect(filter.values?.y).toMatch(/-max_glyph_a'$/);
      expect(
        measureText('Rubik.ttf', filter.values?.text as unknown as string, Number(filter.values?.fontsize))
      ).toBeLessThanOrEqual(1120);
    }
    expect(filters.map((f) => f.values?.text as unknown as string).join(' ')).toBe(text);
  });

  it('caption with an unmeasurable font falls back to the single drawtext', () => {
    const filters = captionToFilters(
      { text: { en: 'Hi there' }, wrap: 'balanced', font: { family: 'Inter' } },
      { scale: '1280:720', motion }
    );

    expect(filters).toHaveLength(1);
  });

  it('kinetic wrap balanced evens the lines without changing the words', () => {
    const frame = { width: 1280, height: 720, fps: 30, duration: 3, seed: 1, energy: 1 };
    const text = 'Same JSON, same frames, everywhere and every single time';
    const lines = (wrap?: 'balanced') => {
      const block = KineticBlockSchema.parse({ text: { en: text }, preset: 'fade', unit: 'line', size: 90, wrap });

      return kineticToFilters(block, { ...frame, text }).map((f) => f.values?.text as unknown as string);
    };
    const greedy = lines();
    const balanced = lines('balanced');
    const widest = (list: string[]) => Math.max(...list.map((l) => measureText('BebasNeue.ttf', l, 90) as number));

    expect(balanced).toHaveLength(greedy.length);
    expect(widest(balanced)).toBeLessThanOrEqual(widest(greedy));
    expect(balanced.join(' ')).toBe(greedy.join(' '));
  });
});
