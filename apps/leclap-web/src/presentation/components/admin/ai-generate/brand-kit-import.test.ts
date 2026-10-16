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

  it('refuses an oversized file and an oversized colour list', async () => {
    await expect(importBrandKit(' '.repeat(MAX_BRAND_KIT_BYTES + 1))).rejects.toThrow(/too large/);

    const colors = Array.from({ length: 201 }, () => kit.colors[0]);

    await expect(importBrandKit(JSON.stringify({ ...kit, colors }))).rejects.toThrow(/brand-kit\.json/);
  });

  it('caps font family names before they reach the rules', async () => {
    const long = 'Z'.repeat(500);
    const fonts = { display: long, body: long, mono: null, families: [long] };
    const imported = await importBrandKit(JSON.stringify({ ...kit, fonts }));

    expect(imported.rules).not.toContain('Z'.repeat(81));
  });
});
