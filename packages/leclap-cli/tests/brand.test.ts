import { describe, expect, it } from 'vitest';
import { brandTheme, type BrandKit } from 'ffmpeg-video-composer';
import { KNOWN_COMMANDS, rewriteArgv } from '../src/args';
import { formatBrandSummary } from '../src/commands/brand';

const kit: BrandKit = {
  url: 'https://brand.test/',
  name: 'Brand',
  colors: [
    { hex: '#3ce6ac', weight: 6, source: 'theme-color' },
    { hex: '#f4f1ea', weight: 4, source: 'declaration' },
  ],
  fonts: { display: null, body: 'Inter', mono: null, families: ['Inter'] },
  logo: { url: 'https://brand.test/logo.png', type: 'png', source: 'apple-touch-icon', file: 'logo.png' },
};

describe('leclap brand', () => {
  it('summarises the name, roles, fonts and logo', () => {
    const lines = formatBrandSummary(kit, brandTheme(kit)).join('\n');

    expect(lines).toContain('Brand');
    expect(lines).toContain('#f4f1ea');
    expect(lines).toMatch(/brand\s+#[0-9a-f]{6}/);
    expect(lines).toContain('Inter → rubik');
    expect(lines).toContain('logo.png');
  });

  it('says why the logo was not saved', () => {
    const lines = formatBrandSummary(
      { ...kit, logo: { ...kit.logo!, file: undefined } },
      brandTheme(kit),
      'too large'
    ).join('\n');

    expect(lines).toContain('logo: not saved (too large)');
  });

  it('says when no logo was found', () => {
    expect(formatBrandSummary({ ...kit, logo: null }, brandTheme(kit)).join('\n')).toContain('none found');
  });

  it('is a known command, not a template to render', () => {
    expect(rewriteArgv(['brand', 'https://brand.test'], KNOWN_COMMANDS)).toEqual(['brand', 'https://brand.test']);
  });
});
