import { describe, expect, it } from 'vitest';
import { decodeRanges, encodeRanges, fontCovers, fontsCovering, isEmoji, isInvisible } from '@/core/font-coverage';
import { FONT_COVERAGE } from '@/core/font-coverage.generated';
import type { TemplateDescriptor } from '@/schemas/template.schemas';
import { validateGlyphCoverage } from '@/services/glyph-coverage';
import { TemplateValidator } from '@/services/TemplateValidator';
import { buildFontCoverage } from '../scripts/generate-font-advances';

function template(section: Record<string, unknown>, global?: Record<string, unknown>): TemplateDescriptor {
  return {
    name: 'test',
    global,
    sections: [{ name: 's', type: 'video', options: { duration: 2 }, ...section }],
  } as unknown as TemplateDescriptor;
}

function captioned(text: unknown, font: unknown = 'anton'): TemplateDescriptor {
  return template({ caption: { text, font } });
}

describe('bundled font coverage', () => {
  it('is generated from the bundled fonts (run pnpm generate:font-advances after changing a font)', () => {
    expect(FONT_COVERAGE).toEqual(buildFontCoverage());
  });

  it('round-trips the compact range encoding', () => {
    const ranges = [32, 126, 160, 383, 8364, 8364, 65_279, 65_535];

    expect(decodeRanges(encodeRanges(ranges))).toEqual(ranges);
    expect(decodeRanges('')).toEqual([]);
  });

  it('answers per code point from the generated ranges', () => {
    expect(fontCovers('Rubik.ttf', 'A'.codePointAt(0) as number)).toBe(true);
    expect(fontCovers('Rubik.ttf', 'Ж'.codePointAt(0) as number)).toBe(true);
    expect(fontCovers('Anton.ttf', 'Ж'.codePointAt(0) as number)).toBe(false);
    expect(fontCovers('Rubik.ttf', '中'.codePointAt(0) as number)).toBe(false);
    expect(fontCovers('Unknown.ttf', 'A'.codePointAt(0) as number)).toBe(false);
  });

  it('agrees with a linear scan of every range (binary search)', () => {
    for (const [file, encoded] of Object.entries(FONT_COVERAGE)) {
      const ranges = decodeRanges(encoded);

      for (let cp = 0; cp < 0x3000; cp++) {
        let linear = false;

        for (let i = 0; i < ranges.length; i += 2) linear ||= cp >= ranges[i] && cp <= ranges[i + 1];

        if (fontCovers(file, cp) !== linear) expect.fail(`${file} U+${cp.toString(16)}`);
      }
    }
  });

  it('finds the bundled fonts covering a set of characters', () => {
    expect(fontsCovering(['א']).map((font) => font.id)).toEqual(['rubik', 'noto-hebrew']);
    expect(fontsCovering(['中'])).toEqual([]);
  });

  it('classifies invisible characters and emoji', () => {
    for (const char of [' ', '\n', '‍', '️', '­']) expect(isInvisible(char), char).toBe(true);
    for (const char of ['😀', '❤', '🏽', '🇫', '⃣']) expect(isEmoji(char), char).toBe(true);
    expect(isEmoji('中')).toBe(false);
  });
});

describe('validateGlyphCoverage', () => {
  it('passes copy the font covers, including the typographic quotes it draws', () => {
    expect(validateGlyphCoverage(captioned({ en: `It's "fine" — 100% Ăă €` }))).toEqual([]);
  });

  it('reports each locale missing glyphs at its own path, with a bundled font that covers them', () => {
    const findings = validateGlyphCoverage(captioned({ en: 'Hello', ru: 'Привет мир' }));

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ path: 'sections[0].caption.text.ru', code: 'font_missing_glyphs' });
    expect(findings[0].message).toContain('font "Anton" has no glyph for "П", "р", "и", "в", "е", "т", "м"');
    expect(findings[0].hint).toContain('"rubik"');
  });

  it('says when no bundled font covers the characters (CJK)', () => {
    const [finding] = validateGlyphCoverage(captioned({ en: '你好' }));

    expect(finding.path).toBe('sections[0].caption.text.en');
    expect(finding.hint).toContain('No bundled font covers them');
  });

  it('lists at most ten characters', () => {
    const [finding] = validateGlyphCoverage(captioned({ en: '一二三四五六七八九十百千' }));

    expect(finding.message).toContain('and 2 more');
    expect(finding.message).not.toContain('"百"');
  });

  it('passes emoji by default: they render as bundled colour images (global.emoji "image" or "strip")', () => {
    expect(validateGlyphCoverage(captioned({ en: 'Ship it 👍🏽 ❤️ 👨‍👩‍👧 1️⃣' }))).toEqual([]);

    for (const emoji of ['image', 'strip']) {
      const descriptor = { ...captioned({ en: 'Ship it 👍🏽 ❤️' }), global: { emoji } } as TemplateDescriptor;

      expect(validateGlyphCoverage(descriptor), emoji).toEqual([]);
    }
  });

  it('still reports missing glyphs next to emoji', () => {
    const findings = validateGlyphCoverage(captioned({ en: 'Привет 🔥' }));

    expect(findings.map((finding) => finding.code)).toEqual(['font_missing_glyphs']);
    expect(findings[0].message).not.toContain('🔥');
  });

  it('reports emoji separately under global.emoji "error", ignoring joiners and variation selectors', () => {
    const descriptor = { ...captioned({ en: 'Ship it 👍🏽 ❤️ 👨‍👩‍👧' }), global: { emoji: 'error' } };
    const findings = validateGlyphCoverage(descriptor as TemplateDescriptor);

    expect(findings.map((finding) => finding.code)).toEqual(['emoji_unsupported']);
    expect(findings[0].hint).toContain('global.emoji');
    expect(findings[0].message).toContain('"👍", "🏽", "❤", "👨", "👩", "👧"');
    expect(findings[0].message).not.toContain('\u200d');
  });

  it('skips fonts whose coverage is unknown: named by family, or a non-bundled file', () => {
    expect(validateGlyphCoverage(captioned({ en: '你好' }, { family: 'Noto Sans JP' }))).toEqual([]);
    expect(validateGlyphCoverage(captioned({ en: '你好' }, 'MyFont.ttf'))).toEqual([]);
  });

  it('skips unresolved variables and checks the descriptor’s own values', () => {
    expect(validateGlyphCoverage(captioned({ en: 'Hi {{ name }}' }))).toEqual([]);

    const resolved = { ...captioned({ en: 'Hi {{ name }}' }), global: { variables: { name: 'Жора' } } };

    expect(validateGlyphCoverage(resolved as TemplateDescriptor)[0].message).toContain('"Ж"');
  });

  it('checks title cards, authored drawtext filters and global overlays at their own paths', () => {
    const findings = validateGlyphCoverage(
      template(
        {
          titleCard: { headline: { en: 'Привет' } },
          filters: [{ type: 'drawtext', values: { text: { en: '中' }, fontfile: 'Oswald.ttf' } }],
        },
        { overlays: [{ text: { en: '中' }, font: 'rubik' }] }
      )
    );

    expect(findings.map((finding) => finding.path).sort()).toEqual([
      'global.overlays[0].text.en',
      'sections[0].filters[0].values.text.en',
      'sections[0].titleCard.headline.en',
    ]);
  });

  it('checks kinetic copy against its font (Bebas Neue by default) and a counter’s affixes', () => {
    const findings = validateGlyphCoverage(
      template({
        kinetic: [
          { preset: 'cascade', text: { en: 'Привет' } },
          { preset: 'counter', text: { en: '' }, font: 'rubik', counter: { from: 0, to: 9, suffix: '中' } },
        ],
      })
    );

    expect(findings.map((finding) => finding.path)).toEqual([
      'sections[0].kinetic[0].text.en',
      'sections[0].kinetic[1].counter.suffix',
    ]);
  });

  it('points kinetic copy no bundled font covers at text sugar, since kinetic needs a bundled font', () => {
    const [finding] = validateGlyphCoverage(template({ kinetic: [{ preset: 'pop', text: { ja: '動く' } }] }));

    expect(finding.hint).toContain('Kinetic blocks need a bundled font');
  });

  it('checks the copy in the section case it is drawn in', () => {
    const lower = template({ options: { duration: 2 }, caption: { text: { en: 'ƒ' }, font: 'mono' } });
    const upper = template({
      options: { duration: 2, upperCase: true },
      caption: { text: { en: 'ƒ' }, font: 'mono' },
    });

    expect(validateGlyphCoverage(lower)).toEqual([]);
    expect(validateGlyphCoverage(upper)[0]?.message).toContain('"Ƒ"');
  });

  it('fails validation with the finding and its hint', () => {
    const result = new TemplateValidator().validateTemplate(captioned({ en: 'Привет' }));
    const finding = result.errors?.find((error) => error.code === 'font_missing_glyphs') as
      | { hint?: string }
      | undefined;

    expect(result.success).toBe(false);
    expect(finding?.hint).toContain('"rubik"');
  });
});
