import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compile, container, loadConfig } from '@/index';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import type { RenderManifest } from '@/core/determinism/manifest';
import type AbstractFFmpeg from '@/platform/ffmpeg/AbstractFFmpeg';
import { DryRunFFmpeg } from './fixtures/dry-run-ffmpeg';
import { testBuildDir } from './fixtures/build-dir';

// Layer keyframe tracks (inputs[].options.animate) through the real director with a dry-run adapter:
// the exact command set per platform profile, as a reviewable golden. Refresh with
// `vp test run tests/layer-keyframes-compile.test.ts -u` and review the diff like code.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const libDir = path.resolve(repoRoot, 'packages/leclap-creative-kit/src/library');
const templatesDir = path.resolve(repoRoot, 'packages/leclap-creative-kit/src/templates');
const buildDir = testBuildDir('layer-keyframes-compile');

const PROFILES = {
  node: {},
  device: { codecConfig: { videoCodec: 'libopenh264' } },
} as const;

const descriptor = {
  global: { orientation: 'landscape', fps: 30, musicEnabled: false },
  sections: [
    {
      name: 'cards',
      type: 'color_background',
      options: { backgroundColor: '#141416', duration: 2 },
      inputs: [
        {
          name: 'badge',
          type: 'image',
          url: 'pictures/logo.png',
          options: {
            position: '540:260',
            scale: '200:200',
            animate: {
              scale: [{ v: 0 }, { t: 0.4, v: 1.2, ease: 'ease-out' }, { t: 0.6, v: 1 }],
              rotate: [{ v: -20 }, { t: 0.6, v: 0, ease: 'ease-out-back' }],
              opacity: [{ v: 0 }, { t: 0.2, v: 1 }],
            },
          },
        },
        {
          name: 'card',
          type: 'html',
          html: '<div class="card"></div>',
          css: '.card { width: 320px; height: 120px; background: #9298fb; border-radius: 24px; }',
          width: 320,
          height: 120,
          options: {
            position: '480:500',
            origin: 'bottom',
            motion: 'fade',
            animate: {
              x: [{ v: '-200' }, { t: 0.8, v: '+0', ease: '$snappy' }],
              scaleY: [{ v: 1 }, { t: 1, v: 0.7 }, { t: 1.2, v: 1.1 }, { t: 1.4, v: 1 }],
            },
          },
        },
      ],
    },
  ],
} as unknown as TemplateDescriptor;

let realAdapter: AbstractFFmpeg;

beforeAll(async () => {
  const first = fs.readdirSync(templatesDir).find((file) => file.endsWith('.json')) as string;

  await loadConfig(path.resolve(templatesDir, first));
  realAdapter = container.resolve<AbstractFFmpeg>('ffmpegAdapter');
  container.registerInstance('ffmpegAdapter', new DryRunFFmpeg());
}, 60000);

afterAll(() => {
  container.registerInstance('ffmpegAdapter', realAdapter);
});

async function compiledGraph(profile: keyof typeof PROFILES): Promise<string> {
  const config = {
    buildDir,
    assetsDir: libDir,
    currentLocale: 'en',
    fields: {},
    userVideoPaths: {},
    audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
    videoConfig: { orientation: 'landscape', scale: '1280:720' },
    skipValidation: true,
    ...PROFILES[profile],
  } as unknown as ProjectConfig;
  let manifest: RenderManifest | undefined;
  const output = await compile(config, descriptor, { onManifest: (m) => (manifest = m) });

  expect(output).not.toBeNull();

  return `${(manifest as RenderManifest).graph.commands.join('\n')}\n`;
}

describe('layer keyframes filtergraph', () => {
  for (const profile of Object.keys(PROFILES) as Array<keyof typeof PROFILES>) {
    it(`compiles to a stable graph (${profile})`, async () => {
      const graph = await compiledGraph(profile);

      // Transforms run on the layer's own frame, before it meets the section canvas.
      expect(graph).toContain('[2:v]fps=30,');
      expect(graph).toMatch(/rotate=a='[^']+\*PI\/180':ow=284:oh=284:c=black@0,scale=w='/);
      expect(graph).toContain("colorchannelmixer=aa=0:enable='lt(t,0.016667)'");
      // The html card keeps its fade entrance (no opacity track) and squashes about its bottom edge.
      expect(graph).toContain('fade=t=in:st=0.3:d=0.6:alpha=1');
      expect(graph).toMatch(/y='620-h'/);
      await expect(graph).toMatchFileSnapshot(`__goldens__/layer-keyframes/${profile}.txt`);
    }, 120000);
  }

  it('compiles an identical template to an identical graph', async () => {
    expect(await compiledGraph('node')).toBe(await compiledGraph('node'));
  }, 120000);
});
