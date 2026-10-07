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

// Filtergraph goldens (docs/plans/motion-system.md §1): the exact, normalized FFmpeg command set each
// bundled template compiles to, per platform profile. Platform-independent (no FFmpeg runs, see
// DryRunFFmpeg), so any change to what a template renders shows up here as a reviewable diff. After an
// intended change, refresh with `pnpm --filter ffmpeg-video-composer exec vp test run
// tests/filtergraph-goldens.test.ts -u` and review the golden diff like code.
//
// Music is disabled: the Node music adapter spawns FFmpeg itself to loop the track, outside the adapter
// seam this suite replaces.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const libDir = path.resolve(repoRoot, 'packages/leclap-creative-kit/src/library');
const templatesDir = path.resolve(repoRoot, 'packages/leclap-creative-kit/src/templates');
const buildDir = testBuildDir('filtergraph-goldens');

const FIELDS: Record<string, string> = {
  form_1_name: 'Alex',
  form_1_lastname: 'Rivera',
  form_1_firstname: 'Alex',
  form_1_job: 'Designer',
  form_1_title: 'Designer',
  form_1_question: 'What drives you',
  form_1_quote: 'Make it count',
  form_1_headline: 'We did it',
  form_1_tagline: 'Made for everyday rituals',
  form_1_price: 'From EUR 24',
  form_1_app: 'LeClap',
  form_1_promise: 'Your story in motion',
  form_1_feature: 'Build your next scene',
  form_1_topic: 'Move your caption',
  form_1_step: 'Drag the text into place',
  form_1_subtitle: 'Made for everyday rituals',
  form_1_cta: 'Create your first video',
  form_1_scene1: 'Morning',
  form_1_scene2: 'Coffee',
  form_1_scene3: 'Work',
  optionA1: 'Tea',
  optionB1: 'Coffee',
  optionA2: 'Beach',
  optionB2: 'Mountains',
  optionA3: 'Cats',
  optionB3: 'Dogs',
};

const PROFILES = {
  node: {},
  device: { codecConfig: { videoCodec: 'libopenh264' } },
} as const;

const TEMPLATE_IDS = fs
  .readdirSync(templatesDir)
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.replace(/\.json$/, ''))
  .sort();

let realAdapter: AbstractFFmpeg;

beforeAll(async () => {
  // loadConfig initializes the platform; then swap the real adapter for the dry run.
  await loadConfig(path.resolve(templatesDir, `${TEMPLATE_IDS[0]}.json`));
  realAdapter = container.resolve<AbstractFFmpeg>('ffmpegAdapter');
  container.registerInstance('ffmpegAdapter', new DryRunFFmpeg());
});

afterAll(() => {
  container.registerInstance('ffmpegAdapter', realAdapter);
});

async function compiledGraph(id: string, profile: keyof typeof PROFILES): Promise<string> {
  const raw = JSON.parse(fs.readFileSync(path.resolve(templatesDir, `${id}.json`), 'utf8')) as TemplateDescriptor;
  const descriptor = { ...raw, global: { ...raw.global, musicEnabled: false } } as TemplateDescriptor;
  const userVideoPaths: Record<string, string> = {};

  for (const section of raw.sections ?? []) {
    if (section.type === 'project_video') userVideoPaths[section.name] = `/media/${section.name}.mp4`;
  }

  const config = {
    buildDir,
    assetsDir: libDir,
    currentLocale: 'en',
    fields: FIELDS,
    userVideoPaths,
    audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
    videoConfig: { orientation: raw.global?.orientation ?? 'landscape', scale: '1280:720' },
    skipValidation: true,
    ...PROFILES[profile],
  } as unknown as ProjectConfig;

  let manifest: RenderManifest | undefined;
  const output = await compile(config, descriptor, { onManifest: (m) => (manifest = m) });

  expect(output, `${id} should compile`).not.toBeNull();

  return `${(manifest as RenderManifest).graph.commands.join('\n')}\n`;
}

describe('filtergraph goldens', () => {
  for (const id of TEMPLATE_IDS) {
    for (const profile of Object.keys(PROFILES) as Array<keyof typeof PROFILES>) {
      it(`${id} (${profile})`, async () => {
        await expect(await compiledGraph(id, profile)).toMatchFileSnapshot(`__goldens__/${profile}/${id}.txt`);
      }, 60000);
    }
  }
});
