import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { compile } from '@/index';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import type { RenderManifest } from '@/core/determinism/manifest';
import type { QcReport } from '@/core/qc/types';
import { testBuildDir } from './fixtures/build-dir';

// The Node-only render services end to end on an asset-free template: the section cache (a warm second
// render copies every segment and is byte-identical to the cold one), the plan hash, the atomic output
// and the output QC.

const buildDir = testBuildDir('render-qc-cache');
const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leclap-section-cache-'));

afterAll(() => {
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

const descriptor: TemplateDescriptor = {
  meta: { name: 'qc-cache' },
  global: { orientation: 'landscape', musicEnabled: false, seed: 3, transition: { type: 'fade', duration: 0.4 } },
  sections: [
    {
      type: 'color_background',
      name: 'first',
      options: { backgroundColor: '#1d2140', duration: 1.2 },
      grade: { grain: 0.3 },
      caption: { text: { en: 'Cached' }, position: 'center', style: 'bar', reveal: 'rise' },
    },
    {
      type: 'color_background',
      name: 'second',
      options: { backgroundColor: '#f2d0a4', duration: 1 },
      caption: { text: { en: 'Twice' }, position: 'bottom', style: 'bar' },
    },
  ],
} as unknown as TemplateDescriptor;

function config(extra: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    buildDir,
    assetsDir: buildDir,
    currentLocale: 'en',
    audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
    videoConfig: { orientation: 'landscape', scale: '640:360' },
    ...extra,
  } as unknown as ProjectConfig;
}

interface Rendered {
  bytes: Buffer;
  manifest: RenderManifest;
  qc?: QcReport;
  output: string;
}

async function render(projectConfig: ProjectConfig, source: TemplateDescriptor = descriptor): Promise<Rendered> {
  const captured: { manifest?: RenderManifest; qc?: QcReport; error?: Error } = {};
  const output = await compile(projectConfig, source, {
    onManifest: (manifest) => (captured.manifest = manifest),
    onQc: (report) => (captured.qc = report),
    onError: (error) => (captured.error = error),
  });

  expect(captured.error).toBeUndefined();
  expect(output).not.toBeNull();

  return {
    bytes: fs.readFileSync(output as string),
    manifest: captured.manifest as RenderManifest,
    qc: captured.qc,
    output: output as string,
  };
}

describe('section cache', () => {
  it('serves a warm render from the cache, byte-identical to the cold one', async () => {
    const uncached = await render(config());
    const cold = await render(config({ cacheDir }));
    const warm = await render(config({ cacheDir }));

    expect(cold.manifest.cache).toMatchObject({ hits: 0, misses: 2 });
    expect(warm.manifest.cache).toMatchObject({ hits: 2, misses: 0 });
    expect(warm.manifest.cache?.sections.map((section) => section.output)).toEqual([
      'first_output.mp4',
      'second_output.mp4',
    ]);
    expect(cold.bytes.equals(uncached.bytes)).toBe(true);
    expect(warm.bytes.equals(cold.bytes)).toBe(true);
    // The cache changes how a segment is obtained, never the plan: same graph, same plan hash.
    expect(warm.manifest.graph.sha256).toBe(cold.manifest.graph.sha256);
    expect(warm.manifest.planHash).toBe(cold.manifest.planHash);
    expect(uncached.manifest.cache).toBeUndefined();
  }, 240000);

  it('misses when a section changes and keeps hitting the unchanged one', async () => {
    const edited = structuredClone(descriptor) as unknown as { sections: Array<{ options: { duration: number } }> };
    edited.sections[1].options.duration = 1.1;

    await render(config({ cacheDir }));
    const changed = await render(config({ cacheDir }), edited as unknown as TemplateDescriptor);

    expect(changed.manifest.cache?.sections).toEqual([
      { output: 'first_output.mp4', hit: true },
      { output: 'second_output.mp4', hit: false },
    ]);
  }, 240000);
});

describe('plan hash and atomic output', () => {
  it('names the plan: stable across renders, changed by the template or the encoder config', async () => {
    const base = await render(config());
    const again = await render(config());
    const reseeded = await render(config(), { ...descriptor, global: { ...descriptor.global, seed: 4 } });
    const draft = await render(config({ qualityTier: 'draft' }));

    expect(base.manifest.planHash).toMatch(/^[0-9a-f]{64}$/);
    expect(again.manifest.planHash).toBe(base.manifest.planHash);
    expect(reseeded.manifest.planHash).not.toBe(base.manifest.planHash);
    expect(draft.manifest.planHash).not.toBe(base.manifest.planHash);
  }, 240000);

  it('publishes output.mp4 by rename and leaves no staging file behind', async () => {
    const { output, manifest } = await render(config());

    expect(path.basename(output)).toBe('output.mp4');
    expect(fs.existsSync(path.join(buildDir, 'output.partial.mp4'))).toBe(false);
    expect(manifest.graph.commands.some((command) => command.endsWith('$BUILD/output.partial.mp4'))).toBe(true);
  }, 240000);

  it('refuses a render whose output is one of its inputs', async () => {
    let failure: Error | undefined;
    const output = await compile(config({ userVideoPaths: { clip: path.join(buildDir, 'output.mp4') } }), descriptor, {
      onError: (error) => (failure = error),
    });

    expect(output).toBeNull();
    expect(failure?.message).toMatch(/Refusing to render: the output .*output\.mp4 is also an input/);
  });
});

describe('output QC', () => {
  it('verifies the format of a clean render', async () => {
    const { qc, manifest } = await render(config({ qc: true }));

    expect(qc?.verified).toBe(true);
    expect(qc?.content).toBe(false);
    expect(qc?.findings.map((finding) => [finding.check, finding.status])).toEqual([
      ['duration', 'pass'],
      ['frame_count', 'pass'],
      ['av_drift', 'pass'],
      ['pixel_format', 'pass'],
      ['color_tags', 'pass'],
      ['audio_present', 'pass'],
    ]);
    expect(manifest.qc).toEqual(qc);
  }, 240000);

  it('runs the content pass on request and reports judgement findings', async () => {
    const { qc } = await render(config({ qc: { content: true } }));
    const byCheck = Object.fromEntries((qc?.findings ?? []).map((finding) => [finding.check, finding]));

    expect(qc?.verified).toBe(true);
    expect(byCheck.black_frames).toMatchObject({ status: 'pass', kind: 'judgement' });
    // The template's audio is the silent bed every card gets; nothing was planned to be heard.
    expect(byCheck.silence).toMatchObject({ status: 'pass', value: 1 });
    expect(byCheck.loudness).toMatchObject({ kind: 'judgement' });
    expect(byCheck.true_peak).toMatchObject({ status: 'pass', value: '-inf' });
  }, 240000);

  it('fails a mostly black render on the content pass', async () => {
    const black = structuredClone(descriptor) as unknown as {
      sections: Array<{ options: { backgroundColor: string }; caption?: unknown; grade?: unknown }>;
    };

    for (const section of black.sections) {
      section.options.backgroundColor = '#000000';
      delete section.caption;
      delete section.grade;
    }

    const { qc } = await render(config({ qc: { content: true } }), black as unknown as TemplateDescriptor);
    const finding = qc?.findings.find((item) => item.check === 'black_frames');

    expect(finding).toMatchObject({ status: 'fail', kind: 'judgement' });
    // Judgement findings never decide `verified`.
    expect(qc?.verified).toBe(true);
  }, 240000);
});
