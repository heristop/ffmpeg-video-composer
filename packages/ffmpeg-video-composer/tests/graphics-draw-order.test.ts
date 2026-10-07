import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compile, container, loadConfig } from '@/index';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import type { RenderManifest } from '@/core/determinism/manifest';
import type AbstractFFmpeg from '@/platform/ffmpeg/AbstractFFmpeg';
import { DryRunFFmpeg } from './fixtures/dry-run-ffmpeg';
import { testBuildDir } from './fixtures/build-dir';

// `above: true` graphics draw after the section's authored chain. The shape is the web-app-promo outro:
// a CTA rises out of an authored drawbox mask, and an underline under the CTA sits inside the masked
// band. Drawn before the authored filters, the mask covered it for the whole section.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const libDir = path.resolve(repoRoot, 'packages/leclap-creative-kit/src/library');
const buildDir = testBuildDir('graphics-draw-order');
const MASK = "drawbox=x=0:y=345:w=iw:h=ih-345:color='#10141e'";
const UNDERLINE = "color='#FF8AAE@1'";

function outro(above: boolean | undefined): TemplateDescriptor {
  return {
    global: { musicEnabled: false },
    sections: [
      {
        name: 'outro',
        type: 'color_background',
        options: { backgroundColor: '#10141e', duration: 3 },
        filters: [
          {
            type: 'drawtext',
            values: { text: { en: 'Start free' }, fontsize: 82, fontcolor: '#ffffff', x: '(w-text_w)/2', y: 282 },
            reveal: { type: 'rise', delay: 0.04, duration: 0.6, distance: 68, easing: 'ease-out' },
          },
          { type: 'drawbox', values: { x: 0, y: 345, w: 'iw', h: 'ih-345', color: '#10141e', t: 'fill' } },
        ],
        graphics: [
          {
            type: 'underline',
            x: 460,
            y: 374,
            width: 360,
            thickness: 5,
            origin: 'center',
            at: 0.6,
            color: '#FF8AAE',
            above,
          },
        ],
      },
    ],
  } as unknown as TemplateDescriptor;
}

let realAdapter: AbstractFFmpeg;

beforeAll(async () => {
  await loadConfig(path.resolve(repoRoot, 'packages/leclap-creative-kit/src/templates/web-app-promo.json'));
  realAdapter = container.resolve<AbstractFFmpeg>('ffmpegAdapter');
  container.registerInstance('ffmpegAdapter', new DryRunFFmpeg());
});

afterAll(() => {
  container.registerInstance('ffmpegAdapter', realAdapter);
});

async function outroCommand(descriptor: TemplateDescriptor): Promise<string> {
  const config = {
    buildDir,
    assetsDir: libDir,
    currentLocale: 'en',
    audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
    videoConfig: { orientation: 'landscape', scale: '1280:720' },
    skipValidation: true,
  } as unknown as ProjectConfig;
  let manifest: RenderManifest | undefined;

  await compile(config, descriptor, { onManifest: (m) => (manifest = m) });

  const command = (manifest as RenderManifest).graph.commands.find((c) => c.includes(MASK));

  expect(command).toBeDefined();

  return command as string;
}

describe('graphics draw order against section filters', () => {
  it('draws an above: true graphic after the authored mask', async () => {
    const command = await outroCommand(outro(true));

    expect(command.indexOf(UNDERLINE)).toBeGreaterThan(command.indexOf(MASK));
  }, 60000);

  it('keeps an above: false graphic under the authored chain', async () => {
    const command = await outroCommand(outro(false));

    expect(command.indexOf(UNDERLINE)).toBeGreaterThan(-1);
    expect(command.indexOf(UNDERLINE)).toBeLessThan(command.indexOf(MASK));
  }, 60000);
});
