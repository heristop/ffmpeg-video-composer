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

// Blended and motion-blurred layers through the real director with a dry-run adapter: the exact command set
// per platform profile, as a reviewable golden. Refresh with `vp test run tests/layer-composite-compile.test.ts -u`.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const libDir = path.resolve(repoRoot, 'packages/leclap-creative-kit/src/library');
const templatesDir = path.resolve(repoRoot, 'packages/leclap-creative-kit/src/templates');
const buildDir = testBuildDir('layer-composite-compile');

const PROFILES = { node: {}, device: { codecConfig: { videoCodec: 'libopenh264' } } } as const;

const card = (name: string, color: string, w: number, h: number, options: Record<string, unknown>) => ({
  name,
  type: 'html',
  html: '<div class="c"></div>',
  css: `.c { width: ${w}px; height: ${h}px; border-radius: 24px; background: ${color}; }`,
  width: w,
  height: h,
  options,
});

const descriptor = {
  global: { orientation: 'landscape', fps: 30, musicEnabled: false },
  sections: [
    {
      name: 'stage',
      type: 'color_background',
      options: { backgroundColor: '#C9D2E0', duration: 2 },
      inputs: [
        card('ink', '#3A2A5C', 320, 180, { position: '200:180', blend: 'multiply' }),
        card('whip', '#FFE9C7', 120, 120, {
          position: '100:500',
          blend: 'screen',
          motionBlur: { shutter: 180, samples: 8 },
          animate: {
            x: [
              { t: 0.5, v: '+0' },
              { t: 1, v: '+700', ease: 'ease-out-cubic' },
            ],
          },
        }),
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

describe('layer composite filtergraph', () => {
  for (const profile of Object.keys(PROFILES) as Array<keyof typeof PROFILES>) {
    it(`compiles to a stable graph (${profile})`, async () => {
      const graph = await compiledGraph(profile);

      expect(graph).toContain('[ink_sly][ink_sba]blend=c0_mode=multiply:c1_mode=multiply:c2_mode=multiply');
      expect(graph).toContain('blend=c0_mode=screen');
      expect(graph).toContain('settb=1/86400');
      expect(graph).toContain('trim=start=0.45:end=1.05');
      expect(graph).toContain("tmix=frames=8,setpts='STARTPTS+floor(N/8)/30/TB',fps=30[whip_bt0]");
      expect(graph).toContain('[whip_sharp][whip_bt0]overlay=0:0:eof_action=pass[whip_mg0]');
      await expect(graph).toMatchFileSnapshot(`__goldens__/layer-composite/${profile}.txt`);
    }, 120000);
  }

  it('compiles an identical template to an identical graph', async () => {
    expect(await compiledGraph('device')).toBe(await compiledGraph('device'));
  }, 120000);
});
