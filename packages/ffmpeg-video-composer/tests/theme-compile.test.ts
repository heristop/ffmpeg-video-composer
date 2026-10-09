import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compile, container, loadConfig } from '@/index';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import type { RenderManifest } from '@/core/determinism/manifest';
import type AbstractFFmpeg from '@/platform/ffmpeg/AbstractFFmpeg';
import { TemplateValidator } from '@/services/TemplateValidator';
import { DryRunFFmpeg } from './fixtures/dry-run-ffmpeg';
import { testBuildDir } from './fixtures/build-dir';

// Theme tokens are resolved before lowering, so a kit template rewritten with `$color.*` / `$font.*` and a
// `global.theme` must compile to exactly the FFmpeg commands of its literal twin (the theme's motion
// energy written out by hand). Dry run, as in the filtergraph goldens: no FFmpeg, no media.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const libDir = path.resolve(repoRoot, 'packages/leclap-creative-kit/src/library');
const templatesDir = path.resolve(repoRoot, 'packages/leclap-creative-kit/src/templates');
const buildDir = testBuildDir('theme-compile');

const FIELDS = { form_1_name: 'Alex', form_1_title: 'Designer', form_1_question: 'Why', form_1_firstname: 'Alex' };

// Literal value → theme token, per template; `fontfile:` entries only rewrite fontfile fields.
const REWRITES: Record<string, { theme: string; energy: number; tokens: Record<string, string> }> = {
  interview: {
    theme: 'midnight',
    energy: 0.8,
    tokens: {
      '#0d1b2a': '$color.bg',
      '#0d1b2a@1': '$color.bg@1',
      '#0d1b2a@0.62': '$color.bg@0.62',
      '#13243f@1': '$color.surface@1',
      '#9aa7c7': '$color.muted',
      '#f5f5f0': '$color.fg',
      '#e8eef7': '$color.brand',
      '#7C83FD': '$color.accent',
      '#7C83FD@1': '$color.accent@1',
      'fontfile:BebasNeue.ttf': '$font.display',
      'fontfile:Oswald.ttf': '$font.body',
    },
  },
  'fast-curious': {
    theme: 'bold',
    energy: 1.3,
    tokens: {
      '#141416': '$color.bg',
      '#141416@0.55': '$color.bg@0.55',
      '#f5f5f0': '$color.fg',
      '#ff2e4d': '$color.accent',
      '#ff2e4d@1': '$color.accent@1',
      'fontfile:BebasNeue.ttf': '$font.display',
      'fontfile:Oswald.ttf': '$font.body',
    },
  },
};

function tokenize(value: unknown, tokens: Record<string, string>, key = ''): unknown {
  if (typeof value === 'string') return tokens[key === 'fontfile' ? `fontfile:${value}` : value] ?? value;

  if (Array.isArray(value)) return value.map((item) => tokenize(item, tokens, key));

  if (value === null || typeof value !== 'object') return value;

  return Object.fromEntries(Object.entries(value).map(([k, child]) => [k, tokenize(child, tokens, k)]));
}

// HTML layers are authored with theme tokens already, so they have no literal twin: both sides drop them.
type DescriptorSection = NonNullable<TemplateDescriptor['sections']>[number];

function withoutHtmlLayers(section: DescriptorSection): DescriptorSection {
  if (!('inputs' in section) || !section.inputs) return section;

  return { ...section, inputs: section.inputs.filter((input) => input.type !== 'html') } as DescriptorSection;
}

function load(id: string): TemplateDescriptor {
  const raw = JSON.parse(fs.readFileSync(path.resolve(templatesDir, `${id}.json`), 'utf8')) as TemplateDescriptor;

  return {
    ...raw,
    global: { ...raw.global, musicEnabled: false },
    sections: raw.sections?.map(withoutHtmlLayers),
  } as TemplateDescriptor;
}

async function graph(descriptor: TemplateDescriptor): Promise<string[]> {
  const userVideoPaths: Record<string, string> = {};

  for (const section of descriptor.sections ?? []) {
    if (section.type === 'project_video') userVideoPaths[section.name] = `/media/${section.name}.mp4`;
  }

  const config = {
    buildDir,
    assetsDir: libDir,
    currentLocale: 'en',
    fields: FIELDS,
    userVideoPaths,
    audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
    videoConfig: { orientation: 'landscape', scale: '1280:720' },
    skipValidation: true,
  } as unknown as ProjectConfig;
  let manifest: RenderManifest | undefined;

  await compile(config, descriptor, { onManifest: (m) => (manifest = m) });

  return (manifest as RenderManifest).graph.commands;
}

let realAdapter: AbstractFFmpeg;

beforeAll(async () => {
  await loadConfig(path.resolve(templatesDir, 'interview.json'));
  realAdapter = container.resolve<AbstractFFmpeg>('ffmpegAdapter');
  container.registerInstance('ffmpegAdapter', new DryRunFFmpeg());
});

afterAll(() => {
  container.registerInstance('ffmpegAdapter', realAdapter);
});

describe('themed templates lower like their literal twins', () => {
  for (const [id, rewrite] of Object.entries(REWRITES)) {
    it(`${id} with the ${rewrite.theme} theme`, async () => {
      const literal = load(id);
      const themed = tokenize(literal, rewrite.tokens) as TemplateDescriptor;

      themed.global = { ...themed.global, theme: rewrite.theme };
      literal.global = { ...literal.global, motion: { ...literal.global?.motion, energy: rewrite.energy } };

      expect(JSON.stringify(themed)).toContain('$color.');
      // The kit's partial registry is injected by the kit catalog, not carried in the JSON file.
      const ownSections = themed.sections?.filter((section) => (section.type as string) !== 'partial');

      expect(new TemplateValidator().validateTemplate({ ...themed, sections: ownSections }).errors).toBeUndefined();
      expect(await graph(themed)).toEqual(await graph(literal));
    }, 60000);
  }
});
