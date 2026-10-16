import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BrandKit } from 'ffmpeg-video-composer';
import { brandFolderName, handleExtractBrand as extractBrand } from '../src/tools/extract-brand.js';
import type { McpConfig } from '../src/config.js';

const kit: BrandKit = {
  url: 'https://brand.test/',
  name: 'Brand',
  colors: [{ hex: '#3ce6ac', weight: 6, source: 'theme-color' }],
  fonts: { display: null, body: 'Inter', mono: null, families: ['Inter'] },
  logo: null,
};

interface Result {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

function handleExtractBrand(...args: Parameters<typeof extractBrand>): Promise<Result> {
  return extractBrand(...args);
}

const mediaDir = mkdtempSync(path.join(tmpdir(), 'mcp-brand-'));
const config = {
  outputDir: mediaDir,
  mediaDir,
  renderTimeoutMs: 1000,
  allowRemotion: false,
  allowNetwork: true,
} as McpConfig;

describe('extract_brand', () => {
  it('saves the kit under the media dir and returns theme and rules', async () => {
    const result = await handleExtractBrand({ url: 'https://brand.test/' }, config, async () => kit);
    const dir = path.join(mediaDir, 'brand-kits', 'brand.test');

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ kit: { name: 'Brand' }, dir });
    expect(String(result.structuredContent?.rules)).toContain('Set global.theme to exactly:');
    expect(JSON.parse(readFileSync(path.join(dir, 'brand-kit.json'), 'utf8')).name).toBe('Brand');
  });

  it('names the folder after the host the fetch ended on, not the requested one', async () => {
    const redirected = { ...kit, url: 'https://www.final.test/' };
    const result = await handleExtractBrand({ url: 'https://short.test/' }, config, async () => redirected);

    expect(result.structuredContent?.dir).toBe(path.join(mediaDir, 'brand-kits', 'www.final.test'));
  });

  it('passes the request signal to the fetcher', async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;

    await handleExtractBrand(
      { url: 'https://brand.test/' },
      config,
      async (_url, signal) => {
        seen = signal;
        return kit;
      },
      controller.signal
    );

    expect(seen).toBe(controller.signal);
  });

  it('reports a fetch failure as a tool error', async () => {
    const result = await handleExtractBrand({ url: 'https://brand.test/' }, config, async () => {
      throw new Error('brand.test doesn’t resolve to a public address');
    });

    expect(result.isError).toBe(true);
  });

  it.each(['[::1]', '1.2.3.4'])('keeps the folder under brand-kits for host %s', async (host) => {
    const odd = { ...kit, url: `https://${host}/` };
    const result = await handleExtractBrand({ url: 'https://brand.test/' }, config, async () => odd);

    expect(String(result.structuredContent?.dir).startsWith(path.join(mediaDir, 'brand-kits') + path.sep)).toBe(true);
  });

  it('reports an unusable host as a tool error', async () => {
    const result = await handleExtractBrand({ url: 'https://brand.test/' }, config, async () => ({
      ...kit,
      url: 'https://[::]/',
    }));

    expect(result.isError).toBe(true);
  });
});

describe('brandFolderName', () => {
  it('lowercases and keeps only [a-z0-9.-]', () => {
    expect(brandFolderName('Brand.TEST')).toBe('brand.test');
    expect(brandFolderName('[::1]')).toBe('1');
    expect(brandFolderName('a..b')).toBe('a.b');
    expect(brandFolderName('..%2fetc')).toBe('2fetc');
    expect(brandFolderName('xn--bcher-kva.example')).toBe('xn--bcher-kva.example');
  });

  it.each(['', '.', '..', '...', '[]', '::', '-', '.-.'])('rejects %j', (host) => {
    expect(() => brandFolderName(host)).toThrow();
  });
});
