import { describe, it, expect } from 'vitest';
import { assetBaseUrl, catalogAssetUrl, fontAssetUrl, isCatalogAssetPath, musicAssetUrl } from '@/core/asset-source';

describe('asset-source', () => {
  it('defaults to the GitHub LFS-resolving raw URL (not raw.githubusercontent)', () => {
    // The creative-kit media (.mp3/.mp4/large .png) are Git-LFS tracked. `raw.githubusercontent.com`
    // serves the LFS pointer text, while `github.com/<o>/<r>/raw/…` redirects to the real binary.
    const base = assetBaseUrl({});

    expect(base).toBe('https://github.com/heristop/leclap/raw/main/packages/leclap-creative-kit/src/library');
    expect(base).not.toContain('raw.githubusercontent.com');
  });

  it('builds music + font URLs from the LFS-resolving base', () => {
    expect(musicAssetUrl('point-being.mp3', {})).toBe(
      'https://github.com/heristop/leclap/raw/main/packages/leclap-creative-kit/src/library/musics/point-being.mp3'
    );
    expect(fontAssetUrl('Oswald.ttf', {})).toBe(
      'https://github.com/heristop/leclap/raw/main/packages/leclap-creative-kit/src/library/fonts/Oswald.ttf'
    );
  });

  it('resolves a catalog-relative reference (the subdir is already in the path) under the base', () => {
    // Descriptors reference bundled media as a catalog-relative path that mirrors the library layout
    // (videos/outro.mp4, pictures/logo.png, animations/light_leak.apng) — so we just prefix the base.
    expect(catalogAssetUrl('videos/outro.mp4', {})).toBe(
      'https://github.com/heristop/leclap/raw/main/packages/leclap-creative-kit/src/library/videos/outro.mp4'
    );
    expect(catalogAssetUrl('pictures/logo.png', {})).toBe(
      'https://github.com/heristop/leclap/raw/main/packages/leclap-creative-kit/src/library/pictures/logo.png'
    );
    // A leading slash on the relative path must not double up against the base.
    expect(catalogAssetUrl('/animations/light_leak.apng', { FVC_ASSET_BASE_URL: 'https://mirror.test/lib' })).toBe(
      'https://mirror.test/lib/animations/light_leak.apng'
    );
  });

  it('honours the FVC_ASSET_BASE_URL override (trailing slash trimmed)', () => {
    expect(assetBaseUrl({ FVC_ASSET_BASE_URL: 'https://mirror.test/lib/' })).toBe('https://mirror.test/lib');
    expect(musicAssetUrl('x.mp3', { FVC_ASSET_BASE_URL: 'https://mirror.test/lib' })).toBe(
      'https://mirror.test/lib/musics/x.mp3'
    );
  });

  it('tells a catalog-relative path from a local path the catalog cannot hold', () => {
    for (const ref of ['pictures/logo.png', 'videos/outro.mp4', 'animations/x.apng', 'musics/a.mp3']) {
      expect(isCatalogAssetPath(ref), ref).toBe(true);
    }

    for (const ref of [
      'bg.png',
      'images/bg.png',
      './pictures/bg.png',
      '../pictures/bg.png',
      '~/bg.png',
      '/abs/bg.png',
    ]) {
      expect(isCatalogAssetPath(ref), ref).toBe(false);
    }

    expect(isCatalogAssetPath('pictures/../../etc/passwd')).toBe(false);
    expect(isCatalogAssetPath('https://a/pictures/x.png')).toBe(false);
  });
});
