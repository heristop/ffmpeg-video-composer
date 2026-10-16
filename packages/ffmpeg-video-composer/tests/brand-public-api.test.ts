import { describe, expect, it } from 'vitest';
import * as api from '@/index';

describe('brand kit public API', () => {
  it('exports the documented brand functions', () => {
    for (const name of ['fetchBrandKit', 'saveBrandKit', 'brandTheme', 'brandPromptRules', 'sanitizeBrandName']) {
      expect(typeof (api as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('keeps the parsers and the address check internal', () => {
    for (const name of [
      'isPublicAddress',
      'parseBrandPage',
      'cssColors',
      'cssFonts',
      'normalizeColor',
      'withThemeColor',
      'nearestBundledFont',
      'BRAND_HEADING',
      'MAX_BRAND_NAME',
      'MAX_BRAND_COLORS',
      'MAX_BRAND_FAMILIES',
      'MAX_FAMILY_NAME',
    ]) {
      expect(api).not.toHaveProperty(name);
    }
  });
});
