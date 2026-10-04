import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundledVideoFor, fieldsFor, videoFor } from '../../../../../../examples/showcase/fixtures.ts';
import { SHOWCASE_SAMPLES, filterSamples, selectedSample, validCategory } from './catalog';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..');

describe('showcase catalog', () => {
  it('includes every shared app template and resolves every source', () => {
    const sources = new Set(SHOWCASE_SAMPLES.map((sample) => sample.source));
    for (const file of readdirSync(path.join(root, 'packages/leclap-creative-kit/src/templates'))) {
      if (file.endsWith('.json')) expect(sources.has(`packages/leclap-creative-kit/src/templates/${file}`)).toBe(true);
    }
    for (const sample of SHOWCASE_SAMPLES) expect(existsSync(path.join(root, sample.source))).toBe(true);
    expect(new Set(SHOWCASE_SAMPLES.map((sample) => sample.id)).size).toBe(SHOWCASE_SAMPLES.length);
  });

  it('combines category filtering with case-insensitive title and description search', () => {
    expect(filterSamples('typography', '  BLUR  ').map((sample) => sample.id)).toEqual(['editorial-blur-rise']);
    expect(filterSamples('overlays', 'blur')).toEqual([]);
    expect(filterSamples('all', 'opposing').map((sample) => sample.id)).toContain('type-impact');
    expect(filterSamples('all', '')).toHaveLength(SHOWCASE_SAMPLES.length);
  });

  it('recovers unknown URL values without a broken player', () => {
    expect(validCategory('missing')).toBe('all');
    expect(selectedSample(null).id).toBe('drink-and-code');
    expect(selectedSample('missing').id).toBe('drink-and-code');
    expect(selectedSample('square-promo').id).toBe('square-promo');
  });

  it('renders forms without options and keeps fixture values within authoring limits', () => {
    const defaults = { app: 'LeClap' };
    const fields = fieldsFor(
      {
        sections: [
          { type: 'form' },
          { type: 'form', options: { fields: [{ name: 'headline', label: { en: 'A longer title' }, maxLength: 4 }] } },
        ],
      },
      defaults
    );
    expect(fields).toEqual({ app: 'LeClap', headline: 'A lo' });
    expect(defaults).toEqual({ app: 'LeClap' });
  });

  it('uses portrait source footage for every scene of portrait templates', () => {
    const templates = ['story-reel', 'product-launch', 'present-yourself-portrait'];
    for (const id of templates) {
      const template = JSON.parse(
        readFileSync(path.join(root, `packages/leclap-creative-kit/src/templates/${id}.json`), 'utf8')
      );
      expect(template.global.orientation).toBe('portrait');
      for (const index of [0, 1, 2]) {
        expect(videoFor(template.global.orientation, index)).toBe('video_portrait.mp4');
      }
    }
    expect(videoFor('landscape', 0)).toBe('video_1.mp4');
    expect(videoFor('landscape', 1)).toBe('video_2.mp4');
    expect(videoFor(undefined, 0)).toBe('video_1.mp4');
  });

  it('uses the cow cup fixture for the Product Launch showcase', () => {
    expect(bundledVideoFor('product-launch')).toBe('examples/showcase/media/moo-mug.mp4');
    const manifest = JSON.parse(
      readFileSync(path.join(root, 'apps/leclap-web/public/videos/showcase/manifest.json'), 'utf8')
    );
    const product = manifest.samples.find((sample: { id: string }) => sample.id === 'product-launch');
    expect(product.mediaSource).toBe(bundledVideoFor('product-launch'));
    expect(existsSync(path.join(root, product.mediaSource))).toBe(true);
    expect(bundledVideoFor('story-reel')).toBeUndefined();
    expect(bundledVideoFor('web-app-promo')).toBe('examples/showcase/media/leclap-canvas.mp4');
  });

  it('preserves the authored soundtrack on the default film and app promo', () => {
    const media = path.join(root, 'apps/leclap-web/public/videos/showcase');
    const manifest = JSON.parse(readFileSync(path.join(media, 'manifest.json'), 'utf8'));
    for (const id of ['drink-and-code', 'web-app-promo']) {
      expect(manifest.samples.find((sample: { id: string }) => sample.id === id).hasAudio).toBe(true);
      expect(readFileSync(path.join(media, `${id}.mp4`)).includes(Buffer.from('mp4a'))).toBe(true);
    }
  });

  it('keeps the promo scene timing at the authored 11.6 seconds', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(root, 'apps/leclap-web/public/videos/showcase/manifest.json'), 'utf8')
    );
    const promo = manifest.samples.find((sample: { id: string }) => sample.id === 'web-app-promo');
    expect(promo.duration).toBeGreaterThanOrEqual(11.5);
    expect(promo.duration).toBeLessThan(11.7);
    expect(existsSync(path.join(root, promo.mediaSource))).toBe(true);
  });

  it('ships a playable preview, poster and source for every sample', () => {
    const media = path.join(root, 'apps/leclap-web/public/videos/showcase');
    const manifest = JSON.parse(readFileSync(path.join(media, 'manifest.json'), 'utf8'));
    expect(manifest.samples.map((sample: { id: string }) => sample.id).sort()).toEqual(
      SHOWCASE_SAMPLES.map((sample) => sample.id).sort()
    );
    for (const sample of SHOWCASE_SAMPLES) {
      for (const extension of ['mp4', 'webp', 'json']) {
        expect(existsSync(path.join(media, `${sample.id}.${extension}`))).toBe(true);
      }
      expect(
        readFileSync(path.join(media, `${sample.id}.mp4`))
          .subarray(4, 8)
          .toString()
      ).toBe('ftyp');
      expect(
        readFileSync(path.join(media, `${sample.id}.webp`))
          .subarray(8, 12)
          .toString()
      ).toBe('WEBP');
    }
  });
});
