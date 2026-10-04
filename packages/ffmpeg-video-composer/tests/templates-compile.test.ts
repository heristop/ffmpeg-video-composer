import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { compile } from '@/index';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import { testBuildDir } from './fixtures/build-dir';

// Smoke-compiles every bundled creative-kit template through the Node engine so a template (or an
// engine change) that breaks a real render is caught. The shared `partial` outro (logo-bumper) is
// stripped — it's exercised by the fixture suite — so this isolates each template's own sections
// (looks, captions, image_background + Ken Burns, countdown cards, lower-thirds, multi project_video).
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const libDir = path.resolve(repoRoot, 'packages/leclap-creative-kit/src/library');
const templatesDir = path.resolve(repoRoot, 'packages/leclap-creative-kit/src/templates');
const videosDir = path.resolve(libDir, 'videos');
// A per-file build dir so this suite never shares build/output.mp4 with the other parallel real-compile
// suites (a sibling's end-of-run cleanup would otherwise delete this file's output mid-render — a race).
const buildDir = testBuildDir('templates-compile');

// Sample values for any form field a template might reference (extra keys are harmless).
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

const TEMPLATE_IDS = fs
  .readdirSync(templatesDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''))
  .sort();

describe('all templates compile (Node smoke)', () => {
  for (const id of TEMPLATE_IDS) {
    it(`compiles ${id}`, async () => {
      const raw = JSON.parse(fs.readFileSync(path.resolve(templatesDir, `${id}.json`), 'utf8')) as TemplateDescriptor;
      const sections = (raw.sections ?? []).filter((s) => s.type !== 'partial');
      const descriptor: TemplateDescriptor = { ...raw, sections };

      const portrait = raw.global?.orientation === 'portrait';
      const clip = path.resolve(videosDir, portrait ? 'video_portrait.mp4' : 'video_1.mp4');

      const userVideoPaths: Record<string, string> = {};
      for (const s of sections) {
        if (s.type === 'project_video') userVideoPaths[s.name] = clip;
      }

      const projectConfig = {
        buildDir,
        assetsDir: libDir,
        currentLocale: 'en',
        audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
        // Always the landscape base scale: TemplateDirector.applyOrientationToScale swaps W:H itself
        // for a portrait descriptor (pre-swapping here would double-swap back to landscape).
        videoConfig: { orientation: portrait ? 'portrait' : 'landscape', scale: '1280:720' },
        fields: FIELDS,
        userVideoPaths,
      } as unknown as ProjectConfig;

      const out = await compile(projectConfig, descriptor);
      expect(out, `${id} should compile`).not.toBeNull();
    }, 180000);
  }
});

// Regression guard for the video-only (no-audio) upload abort: a project_video clip with no audio
// track used to make the transition assembly's `acrossfade` reference a missing `[k:a]` and abort
// ("Stream specifier ':a' matches no streams"). The director now records the source's missing audio
// and the project_video segment appends a silent track. Covers a portrait + a landscape template that
// both transition (acrossfade) and one that composites an animation overlay (the regression site).
describe('templates compile with a video-only (no-audio) clip', () => {
  const noAudioClip = path.resolve(videosDir, 'earth-no-audio.mp4');

  for (const id of ['present-yourself-portrait', 'photo-backdrop']) {
    it(`compiles ${id} when the recorded clip has no audio`, async () => {
      const raw = JSON.parse(fs.readFileSync(path.resolve(templatesDir, `${id}.json`), 'utf8')) as TemplateDescriptor;
      const sections = (raw.sections ?? []).filter((s) => s.type !== 'partial');
      const portrait = raw.global?.orientation === 'portrait';

      const userVideoPaths: Record<string, string> = {};
      for (const s of sections) {
        if (s.type === 'project_video') userVideoPaths[s.name] = noAudioClip;
      }

      const projectConfig = {
        buildDir,
        assetsDir: libDir,
        currentLocale: 'en',
        audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
        // Always the landscape base scale: TemplateDirector.applyOrientationToScale swaps W:H itself
        // for a portrait descriptor (pre-swapping here would double-swap back to landscape).
        videoConfig: { orientation: portrait ? 'portrait' : 'landscape', scale: '1280:720' },
        fields: FIELDS,
        userVideoPaths,
      } as unknown as ProjectConfig;

      const out = await compile(projectConfig, { ...raw, sections });
      expect(out, `${id} should compile with a no-audio clip`).not.toBeNull();
    }, 180000);
  }
});
