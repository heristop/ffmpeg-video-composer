import { describe, expect, it } from 'vitest';
import { filmAsset, filmLang } from './films';

describe('filmLang', () => {
  it('gives French visitors the French cut and everyone else the English one', () => {
    expect(filmLang('fr')).toBe('fr');
    expect(filmLang('fr-CA')).toBe('fr');
    expect(filmLang('de')).toBe('en');
    expect(filmLang(undefined)).toBe('en');
  });
});

describe('filmAsset', () => {
  it('serves the landscape cut by default', () => {
    expect(filmAsset('showcase', 'en')).toEqual({
      mp4: '/videos/films/leclap-showcase.en.mp4',
      poster: '/videos/films/leclap-showcase.en.webp',
      captions: '/videos/films/leclap-showcase.en.vtt',
    });
  });

  it('serves the portrait cut and its poster to a portrait screen', () => {
    expect(filmAsset('agentic', 'fr', 'portrait')).toEqual({
      mp4: '/videos/films/leclap-agentic-portrait.fr.mp4',
      poster: '/videos/films/leclap-agentic-portrait.fr.webp',
      captions: '/videos/films/leclap-agentic.fr.vtt',
    });
  });

  it('keeps one captions track per language: both cuts run on the same clock', () => {
    expect(filmAsset('showcase', 'en', 'portrait').captions).toBe(filmAsset('showcase', 'en').captions);
  });
});
