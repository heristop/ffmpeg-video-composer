import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compile, container, loadConfig } from '@/index';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import type { RenderManifest } from '@/core/determinism/manifest';
import type AbstractFFmpeg from '@/platform/ffmpeg/AbstractFFmpeg';
import { kineticEntranceSpan } from '@/core/kinetic/fit';
import { KineticBlockSchema } from '@/schemas/kinetic.schemas';
import { DryRunFFmpeg } from './fixtures/dry-run-ffmpeg';
import { testBuildDir } from './fixtures/build-dir';

// Time references are compile-time sugar: a template written with "title.end + 0.2", "beat:3",
// "cue:drop" and "end - 0.5" must lower to exactly the graph of the same template written in seconds.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const templatesDir = path.resolve(repoRoot, 'packages/leclap-creative-kit/src/templates');
const buildDir = testBuildDir('time-refs-compile');

const TITLE = { text: { en: 'Name the moment' }, preset: 'cascade' as const, delay: 0.3 };
const TITLE_END =
  0.3 +
  kineticEntranceSpan(
    KineticBlockSchema.parse(TITLE),
    { width: 1280, height: 720, fps: 30, duration: 4, seed: 0, energy: 1 },
    'Name the moment'
  );

function descriptor(times: {
  barAt: number | string;
  flashAt: number | string;
  until: number | string;
  subtitle: number | string;
  hit: number | string;
  key: number | string;
  label: number | string;
  labelOut: number | string;
}): TemplateDescriptor {
  return {
    global: { orientation: 'landscape', fps: 30, musicEnabled: false, seed: 3, beats: { bpm: 120, offset: 0.1 } },
    sections: [
      {
        name: 'card',
        type: 'color_background',
        options: { backgroundColor: '#101014', duration: 4 },
        cues: { drop: 2.2 },
        kinetic: [
          { id: 'title', ...TITLE },
          { text: { en: 'on the beat' }, preset: 'fade', size: 40, y: 'bottom', delay: times.subtitle },
        ],
        graphics: [
          { id: 'rule', type: 'underline', at: times.barAt, duration: 0.4, x: 100, y: 500, width: 400 },
          { type: 'flash', at: times.flashAt, until: times.until, duration: 0.2 },
        ],
        camera: { preset: 'push-in', amount: 0.06, hits: [times.hit] },
        filters: [
          {
            type: 'drawtext',
            values: { text: { en: 'cue' }, fontsize: 40, x: 60, y: 60 },
            animate: {
              opacity: [
                { t: times.key, v: 0 },
                { t: '+0.3', v: 1 },
              ],
            },
          },
          {
            type: 'drawtext',
            id: 'label',
            values: { text: { en: 'label' }, fontsize: 32, x: 60, y: 620 },
            reveal: { type: 'rise', delay: times.label, duration: 0.4 },
            exit: { type: 'fade', after: times.labelOut },
          },
        ],
      },
    ],
  } as unknown as TemplateDescriptor;
}

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

async function graph(template: TemplateDescriptor): Promise<string> {
  const config = {
    buildDir,
    currentLocale: 'en',
    audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
    videoConfig: { orientation: 'landscape', scale: '1280:720' },
    skipValidation: true,
  } as unknown as ProjectConfig;
  let manifest: RenderManifest | undefined;

  expect(await compile(config, template, { onManifest: (m) => (manifest = m) })).not.toBeNull();

  return (manifest as RenderManifest).graph.commands.join('\n');
}

describe('time references compile to the same graph as seconds', () => {
  it('lowers element, beat, cue, percentage and end references like the equivalent numbers', async () => {
    const anchored = await graph(
      descriptor({
        barAt: 'title.end + 0.2',
        flashAt: 'cue:drop - 0.1',
        until: 'end - 0.5',
        subtitle: 'rule.end + 0.1',
        hit: 'beat:5',
        key: '25%',
        label: 'title.start + 0.5',
        labelOut: 'label.end + 1',
      })
    );
    const barAt = Number((TITLE_END + 0.2).toFixed(6));
    const numeric = await graph(
      descriptor({
        barAt,
        flashAt: 2.1,
        until: 3.5,
        subtitle: Number((barAt + 0.4 + 0.1).toFixed(6)),
        // beat 5 = 0.1 + 4 × 0.5 = 2.1 s, in the first section.
        hit: 2.1,
        key: 1,
        label: 0.8,
        labelOut: 2.2,
      })
    );

    expect(anchored).toContain('drawbox');
    expect(anchored).toBe(numeric);
  }, 60000);
});
