import { describe, expect, it } from 'vitest';
import { contrastRatio } from '@/core/color-contrast';
import { hexToRgb } from '@/core/style/oklab';
import { brandPromptRules, brandTheme, nearestBundledFont, type BrandKit } from '@/core/brand';
import { ThemeObjectSchema } from '@/schemas/theme.schemas';

const kit: BrandKit = {
  url: 'https://acme.test/',
  name: 'Acme',
  colors: [
    { hex: '#3ce6ac', weight: 9, source: 'custom-property' },
    { hex: '#f4f1ea', weight: 6, source: 'declaration' },
    { hex: '#111111', weight: 3, source: 'declaration' },
    { hex: '#a46cf5', weight: 2, source: 'declaration' },
  ],
  fonts: { display: 'ABC Solar Display', body: 'Inter', mono: null, families: ['Inter', 'ABC Solar Display'] },
  logo: { url: 'https://acme.test/apple-touch-icon.png', type: 'png', source: 'apple-touch-icon', file: 'logo.png' },
};

describe('brandTheme', () => {
  const brand = brandTheme(kit);

  it('is a valid theme object over the leclap base', () => {
    expect(ThemeObjectSchema.safeParse(brand.theme).success).toBe(true);
    expect(brand.theme.extends).toBe('leclap');
  });

  it('keeps the brand colour and readable text', () => {
    expect(brand.theme.colors?.brand ?? brand.theme.colors?.accent).toBe('#3ce6ac');
    expect(
      contrastRatio(hexToRgb(brand.theme.colors?.fg ?? ''), hexToRgb(brand.theme.colors?.bg ?? ''))
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('maps fonts to bundled ids and keeps the exact families as suggestions', () => {
    expect(brand.theme.fonts).toEqual({ display: 'archivo-black', body: 'rubik', mono: 'mono' });
    expect(brand.fontRefs).toEqual({ display: { family: 'ABC Solar Display' }, body: { family: 'Inter' } });
  });

  it('survives a colourless site', () => {
    const plain = brandTheme({
      ...kit,
      colors: [
        { hex: '#ffffff', weight: 3, source: 'declaration' },
        { hex: '#000000', weight: 2, source: 'declaration' },
      ],
    });

    expect(ThemeObjectSchema.safeParse(plain.theme).success).toBe(true);
    expect(plain.roles.accent.source).not.toBe('extracted');
  });
});

describe('nearestBundledFont', () => {
  it('uses a bundled font when the brand already uses it', () => {
    expect(nearestBundledFont('Playfair Display', 'display')).toBe('playfair');
    expect(nearestBundledFont('Bebas Neue', 'body')).toBe('bebas');
  });

  it('picks by kind otherwise', () => {
    expect(nearestBundledFont('Some Serif', 'display')).toBe('playfair');
    expect(nearestBundledFont('Acme Condensed', 'display')).toBe('oswald');
    expect(nearestBundledFont('JetBrains Mono', 'mono')).toBe('mono');
    expect(nearestBundledFont(null, 'body')).toBe('rubik');
  });
});

describe('brandPromptRules', () => {
  it('names the brand, binds the theme and places the logo', () => {
    const rules = brandPromptRules(kit, brandTheme(kit), '/assets/brand/logo.png');

    expect(rules).toContain('Acme');
    expect(rules).toContain('Set global.theme to exactly:');
    expect(rules).toContain('/assets/brand/logo.png');
    expect(rules).toMatch(/never recolou?r/i);
  });
});
