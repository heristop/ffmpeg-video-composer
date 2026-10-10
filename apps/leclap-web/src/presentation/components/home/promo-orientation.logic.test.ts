import { describe, expect, it } from 'vitest';
import { PORTRAIT_PROMO_QUERY, effectsReelSources, promoOrientation } from './promo-orientation.logic';

describe('PORTRAIT_PROMO_QUERY', () => {
  it('targets phone-width screens held upright', () => {
    expect(PORTRAIT_PROMO_QUERY).toContain('(orientation: portrait)');
    expect(PORTRAIT_PROMO_QUERY).toContain('(max-width: 767px)');
  });
});

describe('promoOrientation', () => {
  it('plays the portrait cuts while the query matches', () => {
    expect(promoOrientation(true)).toBe('portrait');
  });

  it('plays the landscape cuts everywhere else', () => {
    expect(promoOrientation(false)).toBe('landscape');
  });
});

describe('effectsReelSources', () => {
  it('serves the landscape reel, WebM first with an MP4 fallback', () => {
    expect(effectsReelSources('landscape')).toEqual({
      webm: '/videos/home/effects-reel.webm',
      mp4: '/videos/home/effects-reel.mp4',
      poster: '/videos/home/effects-reel.webp',
    });
  });

  it('serves the portrait reel to a portrait screen', () => {
    expect(effectsReelSources('portrait')).toEqual({
      webm: '/videos/home/effects-reel-portrait.webm',
      mp4: '/videos/home/effects-reel-portrait.mp4',
      poster: '/videos/home/effects-reel-portrait.webp',
    });
  });
});
