import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { compile, container, loadConfig } from '@/index';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import type { RenderManifest } from '@/core/determinism/manifest';
import type AbstractFFmpeg from '@/platform/ffmpeg/AbstractFFmpeg';
import { TRANSCRIPTION_SERVICE, type TranscriptionService } from '@/director/transcribe-sections';
import { DryRunFFmpeg } from './fixtures/dry-run-ffmpeg';
import { testBuildDir } from './fixtures/build-dir';

// `subtitles.transcribe` in a Node compile: the director transcribes the section's clip once it is
// probed, maps the words through the clip range and draws them like authored words. A fake transcription
// service stands in for whisper.cpp; the FFmpeg adapter runs nothing.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const libDir = path.resolve(repoRoot, 'packages/leclap-creative-kit/src/library');
const buildDir = testBuildDir('transcribe-compile');
const clipDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcribe-compile-'));
const clip = path.join(clipDir, 'talk.mp4');

const service: TranscriptionService = {
  transcribe: vi.fn(async () => ({
    engine: 'whisper.cpp',
    model: 'base',
    language: 'en',
    words: [
      { text: 'Skipped', start: 0.1, end: 0.5, confidence: 0.9 },
      { text: 'Hello', start: 1.2, end: 1.6, confidence: 0.9 },
      { text: 'world', start: 1.7, end: 2.1, confidence: 0.9 },
    ],
  })),
  digest: async () => 'sha256:talk',
};

let realAdapter: AbstractFFmpeg;

beforeAll(async () => {
  fs.writeFileSync(clip, '');
  await loadConfig(path.resolve(repoRoot, 'packages/leclap-creative-kit/src/templates/web-app-promo.json'));
  realAdapter = container.resolve<AbstractFFmpeg>('ffmpegAdapter');
  container.registerInstance('ffmpegAdapter', new DryRunFFmpeg());
  container.registerInstance(TRANSCRIPTION_SERVICE, service);
});

afterAll(() => {
  container.registerInstance('ffmpegAdapter', realAdapter);
  fs.rmSync(clipDir, { recursive: true, force: true });
});

const descriptor = {
  global: { musicEnabled: false },
  sections: [
    {
      name: 'talk',
      type: 'project_video',
      options: { clip: { from: 1 } },
      subtitles: { transcribe: { language: 'en' }, karaoke: false },
    },
  ],
} as unknown as TemplateDescriptor;

describe('subtitles.transcribe in a Node compile', () => {
  it('transcribes the clip and draws the pinned words in section time', async () => {
    const config = {
      buildDir,
      assetsDir: libDir,
      currentLocale: 'en',
      userVideoPaths: { talk: clip },
      audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
      videoConfig: { orientation: 'landscape', scale: '1280:720' },
      skipValidation: true,
    } as unknown as ProjectConfig;
    let manifest: RenderManifest | undefined;

    await compile(config, descriptor, { onManifest: (m) => (manifest = m) });

    const commands = (manifest as RenderManifest).graph.commands.join('\n');

    expect(service.transcribe).toHaveBeenCalledWith(clip, { language: 'en', signal: expect.any(AbortSignal) });
    expect(commands).toContain('Hello world');
    expect(commands).not.toContain('Skipped');
    // "Hello" is spoken at 1.2 s of the clip, 0.2 s into the section (clip.from = 1), shown 0.08 s early.
    expect(commands).toContain("enable='gte(t,0.12)");
  });
});
