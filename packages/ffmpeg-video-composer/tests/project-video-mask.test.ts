import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compile, container, loadConfig } from '@/index';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import type { RenderManifest } from '@/core/determinism/manifest';
import type AbstractFFmpeg from '@/platform/ffmpeg/AbstractFFmpeg';
import { encodePng } from '@/editor/presets/png-encode';
import { DryRunFFmpeg } from './fixtures/dry-run-ffmpeg';
import { testBuildDir } from './fixtures/build-dir';

// A section mask (options.mask) on a project_video: the recorded clip stays input 0 and the shape mask is
// staged after it; a track matte reads its layer through the same graph. Asserted on the real commands, via a
// dry-run adapter.
const here = path.dirname(fileURLToPath(import.meta.url));
const templatesDir = path.resolve(here, '../../leclap-creative-kit/src/templates');
const buildDir = testBuildDir('project-video-mask');

let realAdapter: AbstractFFmpeg;

beforeAll(async () => {
  const first = fs.readdirSync(templatesDir).find((file) => file.endsWith('.json')) as string;

  await loadConfig(path.resolve(templatesDir, first));
  realAdapter = container.resolve<AbstractFFmpeg>('ffmpegAdapter');
  container.registerInstance('ffmpegAdapter', new DryRunFFmpeg());
});

afterAll(() => {
  container.registerInstance('ffmpegAdapter', realAdapter);
});

function holePng(): string {
  const file = path.join(buildDir, 'hole.png');

  fs.mkdirSync(buildDir, { recursive: true });
  fs.writeFileSync(file, encodePng({ width: 2, height: 2, channels: 4, data: new Uint8Array(16).fill(255) }));

  return file;
}

async function commandsOf(section: Record<string, unknown>): Promise<string> {
  const config = {
    buildDir,
    currentLocale: 'en',
    userVideoPaths: { clip: '/media/clip.mp4' },
    audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
    videoConfig: { orientation: 'landscape', scale: '1280:720' },
    skipValidation: true,
  } as unknown as ProjectConfig;
  const template = {
    global: { orientation: 'landscape', fps: 30, musicEnabled: false },
    sections: [{ name: 'clip', type: 'project_video', ...section }],
  } as unknown as TemplateDescriptor;
  let manifest: RenderManifest | undefined;

  await compile(config, template, { onManifest: (m) => (manifest = m) });

  return (manifest as RenderManifest).graph.commands.join('\n');
}

describe('masks on a project_video section', () => {
  it('composites the recorded clip through a shape mask image staged after it', async () => {
    const shape = { type: 'ellipse', cx: 640, cy: 360, rx: 300, ry: 200 };
    const commands = await commandsOf({ options: { duration: 4, mask: { shape, feather: 8 } } });

    expect(commands).toMatch(/-i \$VIDEO\{clip\} -loop 1 -i \S*mask-\w+\.png/);
    expect(commands).toContain('[0:v]setsar=1/1,scale=1280:720');
    expect(commands).toContain('[1:v]null[sm.s.l]');
    expect(commands).toContain('[sm.s.d][sm.s.m]alphamerge[sm.s.a]');
    expect(commands).toContain('-map [ctag] -map 0:a?');
  });

  it('composites the clip through a track matte layer into the matte output pad', async () => {
    const commands = await commandsOf({
      options: { duration: 4, mask: { layer: 'hole', mode: 'luma' } },
      inputs: [{ name: 'hole', type: 'image', url: holePng(), options: { position: '100:100' } }],
    });

    expect(commands).toContain('[1:v]null[hole.mt_src]');
    expect(commands).toContain('[sm.s.mk_z][hole.mt_src]overlay=100:100:eof_action=pass:format=rgb');
    expect(commands).toContain('[sm.s.mk_b][sm.s.mk_a]overlay=0:0[sm.s.mk_out];[sm.s.mk_out]setparams=');
    expect(commands).toContain('-map [ctag] -map 0:a?');
  });

  it('gives a section matte and a masked layer named sm no pad label in common', async () => {
    const shape = { type: 'ellipse', cx: 640, cy: 360, rx: 100, ry: 100 };
    const commands = await commandsOf({
      options: { duration: 4, mask: { layer: 'hole' } },
      inputs: [
        { name: 'hole', type: 'image', url: holePng(), options: { position: '100:100' } },
        { name: 'sm', type: 'image', url: holePng(), options: { position: '10:10', mask: { shape } } },
      ],
    });
    const graph = /-filter_complex "([^"]+)"/.exec(commands)?.[1] ?? '';
    const produced = graph.split(';').flatMap((chain) => [...(chain.match(/\[[^\]]+\]$/) ?? [])]);

    expect(graph).toContain('[sm.mk_o]');
    expect(graph).toContain('[sm.s.mk_o]');
    expect(new Set(produced).size).toBe(produced.length);
  });
});
