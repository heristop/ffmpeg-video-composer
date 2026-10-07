import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compile } from '@/index';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import type { RenderManifest } from '@/core/determinism/manifest';
import type { FormatName } from '@/core/formats';
import { TemplateValidator } from '@/services/TemplateValidator';
import { X264_COLOR_PARAMS, buildColorMetadataArgs } from '@/core/encoding';
import { testBuildDir } from './fixtures/build-dir';

// One story, three formats (examples/motion-design/formats.json) through real FFmpeg: each format is its
// own composition with a stable compiled graph (golden), and a format render is byte-deterministic.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const example = path.resolve(repoRoot, 'examples/motion-design/formats.json');
const libDir = path.resolve(repoRoot, 'packages/leclap-creative-kit/src/library');
const buildDir = testBuildDir('formats-render');

const descriptor = JSON.parse(fs.readFileSync(example, 'utf8')) as TemplateDescriptor;

function config(format: FormatName): ProjectConfig {
  return {
    buildDir,
    assetsDir: libDir,
    currentLocale: 'en',
    format,
    audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
    videoConfig: { scale: '1280:720' },
  } as unknown as ProjectConfig;
}

// Same normalisation as motion-render.test.ts: colour-tag flags follow the local FFmpeg version.
function graphGolden(manifest: RenderManifest): string {
  return `${manifest.graph.commands.join('\n').replaceAll(X264_COLOR_PARAMS, buildColorMetadataArgs())}\n`;
}

async function render(format: FormatName): Promise<{ bytes: Buffer; manifest: RenderManifest }> {
  let manifest: RenderManifest | undefined;
  const output = await compile(config(format), descriptor, { onManifest: (m) => (manifest = m) });

  expect(output).not.toBeNull();

  return { bytes: fs.readFileSync(output as string), manifest: manifest as RenderManifest };
}

describe('formats example', () => {
  it('validates cleanly in every format, with no advisory', async () => {
    const validator = new TemplateValidator();

    expect(validator.validateTemplate(descriptor).errors ?? []).toEqual([]);
    expect(validator.getMotionWarnings(descriptor)).toEqual([]);
    expect(await validator.getGeometryWarnings(descriptor as never)).toEqual([]);
  });

  // Sequential: every render shares the build directory.
  it('compiles each format to its own composition (goldens)', async () => {
    const graphs: Record<string, string> = {};

    for (const format of ['landscape', 'portrait', 'square'] as const) {
      graphs[format] = graphGolden((await render(format)).manifest);
      await expect(graphs[format]).toMatchFileSnapshot(`__goldens__/motion/formats-${format}.txt`);
    }

    expect(graphs.portrait).toContain('720x1280');
    expect(graphs.square).toContain('1080x1080');
    // Square drops the proof beat; portrait drops its aside.
    expect(graphs.landscape).toContain("text='per-format'");
    expect(graphs.portrait).toContain(String.raw`text='After\:'`);
    expect(graphs.portrait).not.toContain("text='per-format'");
    expect(graphs.square).not.toContain(String.raw`text='After\:'`);
  }, 600000);

  it('renders the portrait format twice to identical bytes', async () => {
    const first = await render('portrait');
    const second = await render('portrait');

    expect(second.bytes.equals(first.bytes)).toBe(true);
    expect(first.manifest.deterministic).toBe(true);
  }, 300000);
});
