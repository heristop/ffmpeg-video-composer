import { describe, expect, it } from 'vitest';
import { importBrandKit, MAX_BRAND_KIT_BYTES } from './brand-kit-import';

const kit = {
  url: 'https://brand.test/',
  name: 'Brand',
  colors: [
    { hex: '#3ce6ac', weight: 6, source: 'theme-color' },
    { hex: '#f4f1ea', weight: 4, source: 'declaration' },
  ],
  fonts: { display: null, body: 'Inter', mono: null, families: ['Inter'] },
  logo: { url: 'https://brand.test/logo.png', type: 'png', source: 'apple-touch-icon', file: 'logo.png' },
};

describe('importBrandKit', () => {
  it('builds binding rules from a brand-kit.json', async () => {
    const imported = await importBrandKit(JSON.stringify(kit));

    expect(imported.name).toBe('Brand');
    expect(imported.rules).toContain('Set global.theme to exactly:');
    // The builder has no logo file: the rules don't point at one.
    expect(imported.rules).not.toContain('logo.png');
  });

  it('accepts a kit whose logo has no file', async () => {
    const { file: _file, ...logo } = kit.logo;

    await expect(importBrandKit(JSON.stringify({ ...kit, logo }))).resolves.toHaveProperty('name', 'Brand');
  });

  it('refuses a file that isn’t a brand kit', async () => {
    await expect(importBrandKit('{"sections":[]}')).rejects.toThrow(/brand-kit\.json/);
    await expect(importBrandKit('not json')).rejects.toThrow(/brand-kit\.json/);
  });

  it('refuses an oversized file', async () => {
    await expect(importBrandKit(' '.repeat(MAX_BRAND_KIT_BYTES + 1))).rejects.toThrow(/too large/);
  });

  it('imports a large design system’s kit, keeping its heaviest colours', async () => {
    const shades = Array.from({ length: 600 }, (_, n) => ({
      hex: `#${n.toString(16).padStart(6, '0')}`,
      weight: 1,
      source: 'declaration',
    }));
    const colors = [...shades, { hex: '#3ce6ac', weight: 5000, source: 'theme-color' }];
    const families = Array.from({ length: 600 }, (_, n) => `Face${n}`);
    const imported = await importBrandKit(JSON.stringify({ ...kit, colors, fonts: { ...kit.fonts, families } }));

    expect(imported.rules).toContain('Set global.theme to exactly:');
    expect(imported.rules).toContain('#3ce6ac');
  });

  it('caps font family names before they reach the rules', async () => {
    const long = 'Z'.repeat(500);
    const fonts = { display: long, body: long, mono: null, families: [long] };
    const imported = await importBrandKit(JSON.stringify({ ...kit, fonts }));

    expect(imported.rules).not.toContain('Z'.repeat(81));
  });
});
