import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compile } from '@/index';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import type { RenderManifest } from '@/core/determinism/manifest';
import { testBuildDir } from './fixtures/build-dir';

// The P0 exit criterion, on an asset-free template so it runs anywhere FFmpeg does: two renders of the
// same template are byte-identical, and the manifest proves it (template, graph and output digests).

const buildDir = testBuildDir('determinism-render');

const descriptor: TemplateDescriptor = {
  meta: { name: 'determinism' },
  global: { orientation: 'landscape', musicEnabled: false, seed: 7 },
  sections: [
    {
      type: 'color_background',
      name: 'card',
      options: { backgroundColor: '#1d2140', duration: 1 },
      grade: { grain: 0.4 },
      caption: { text: { en: 'Deterministic' }, position: 'center', style: 'bar', reveal: 'rise' },
    },
  ],
} as unknown as TemplateDescriptor;

const config = {
  buildDir,
  assetsDir: buildDir,
  currentLocale: 'en',
  audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
  videoConfig: { orientation: 'landscape', scale: '640:360' },
} as unknown as ProjectConfig;

async function renderWithManifest(source: TemplateDescriptor): Promise<{ bytes: Buffer; manifest: RenderManifest }> {
  let manifest: RenderManifest | undefined;
  const output = await compile(config, source, { onManifest: (m) => (manifest = m) });

  expect(output).not.toBeNull();
  expect(manifest).toBeDefined();

  return { bytes: fs.readFileSync(output as string), manifest: manifest as RenderManifest };
}

describe('deterministic render', () => {
  it('renders byte-identical output twice and records it in the manifest', async () => {
    const first = await renderWithManifest(descriptor);
    const second = await renderWithManifest(descriptor);

    expect(second.bytes.equals(first.bytes)).toBe(true);
    expect(second.manifest.output?.sha256).toBe(first.manifest.output?.sha256);
    expect(second.manifest.graph.sha256).toBe(first.manifest.graph.sha256);
    expect(first.manifest).toMatchObject({
      deterministic: true,
      template: { seed: 7 },
      engine: { name: 'ffmpeg-video-composer' },
    });
  }, 240000);

  it('applies the motion chain: CFR conform, seeded grain and bit-exact muxing', async () => {
    const { manifest } = await renderWithManifest(descriptor);
    const segment = manifest.graph.commands.find((command) => command.includes('card_output'));

    expect(segment).toMatch(/crop=640:360,fps=30,/);
    expect(segment).toMatch(/noise=alls=8:allf=t\+u:all_seed=\d+/);
    expect(manifest.graph.commands.every((command) => command.includes('+bitexact'))).toBe(true);
    expect(segment).toContain('$BUILD/');
  }, 240000);

  it('changes the grain stream, and only that, with a new seed', async () => {
    const base = await renderWithManifest(descriptor);
    const reseeded = await renderWithManifest({ ...descriptor, global: { ...descriptor.global, seed: 8 } });
    const seedOf = (m: RenderManifest) => /all_seed=(\d+)/.exec(m.graph.commands.join(' '))?.[1];

    expect(seedOf(reseeded.manifest)).not.toBe(seedOf(base.manifest));
    expect(reseeded.manifest.template.sha256).not.toBe(base.manifest.template.sha256);
  }, 240000);
});
