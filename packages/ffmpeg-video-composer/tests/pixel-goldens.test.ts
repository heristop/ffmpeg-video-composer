import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compile } from '@/index';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import type { RenderManifest } from '@/core/determinism/manifest';
import { testBuildDir } from './fixtures/build-dir';
import { compareAudio, compareFrames, frameCount, spreadFrames } from './fixtures/pixel-compare';

// Pixel goldens on a real template: the section cache must be invisible in the output. A render served
// from the cache, wholly or in part, decodes to the same frames and the same samples as a fresh render.

const here = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.resolve(here, '../../../examples/motion-design/camera-and-graphics.json');
const buildDir = testBuildDir('pixel-goldens');
const keepDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leclap-pixel-goldens-'));
const cacheDir = path.join(keepDir, 'cache');

const config = {
  buildDir,
  assetsDir: buildDir,
  currentLocale: 'en',
  audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
  videoConfig: { orientation: 'landscape', scale: '640:360' },
} as unknown as ProjectConfig;

let template: TemplateDescriptor;

beforeAll(() => {
  template = JSON.parse(fs.readFileSync(templatePath, 'utf8')) as TemplateDescriptor;
});

afterAll(() => {
  fs.rmSync(keepDir, { recursive: true, force: true });
});

// Renders and moves the output aside (the next render reuses the build dir).
async function render(name: string, descriptor: TemplateDescriptor, extra: Partial<ProjectConfig> = {}) {
  const captured: { manifest?: RenderManifest; error?: Error } = {};
  const output = await compile({ ...config, ...extra }, descriptor, {
    onManifest: (manifest) => (captured.manifest = manifest),
    onError: (error) => (captured.error = error),
  });

  expect(captured.error).toBeUndefined();
  expect(output).not.toBeNull();

  const kept = path.join(keepDir, `${name}.mp4`);
  fs.renameSync(output as string, kept);

  return { file: kept, manifest: captured.manifest as RenderManifest };
}

function expectIdenticalFrames(a: string, b: string): void {
  const comparison = compareFrames(a, b, { frames: spreadFrames(frameCount(a), 12) });

  expect(comparison.failing, `differing frames dumped to ${comparison.dumpDir}`).toEqual([]);
  expect(comparison.frames.every((frame) => frame.psnr === Number.POSITIVE_INFINITY)).toBe(true);
}

describe('pixel goldens: camera-and-graphics', () => {
  it('renders the same frames and samples with the section cache off, cold and warm', async () => {
    const fresh = await render('fresh', template);
    const cold = await render('cold', template, { cacheDir });
    const warm = await render('warm', template, { cacheDir });

    expect(cold.manifest.cache?.hits).toBe(0);
    expect(warm.manifest.cache?.misses).toBe(0);
    expect(warm.manifest.cache?.hits).toBe(template.sections?.length);

    expectIdenticalFrames(fresh.file, cold.file);
    expectIdenticalFrames(fresh.file, warm.file);
    expect(compareAudio(fresh.file, warm.file).residualRmsDb).toBe(Number.NEGATIVE_INFINITY);
    expect(fs.readFileSync(warm.file).equals(fs.readFileSync(fresh.file))).toBe(true);
  }, 600000);

  it('is chunk-invariant: sections cached by another composition assemble into the same video', async () => {
    const chunkCache = path.join(keepDir, 'chunk-cache');
    const sections = template.sections ?? [];
    // Warm the cache with every other section, rendered as a template of their own.
    const chunk = { ...template, sections: sections.filter((_, index) => index % 2 === 0) } as TemplateDescriptor;
    await render('chunk', chunk, { cacheDir: chunkCache });

    const whole = await render('whole', template);
    const assembled = await render('assembled', template, { cacheDir: chunkCache });

    expect(assembled.manifest.cache).toMatchObject({
      hits: chunk.sections?.length,
      misses: sections.length - (chunk.sections?.length ?? 0),
    });
    expectIdenticalFrames(whole.file, assembled.file);
    expect(compareAudio(whole.file, assembled.file).residualRmsDb).toBe(Number.NEGATIVE_INFINITY);
  }, 600000);
});

// Seeded film grain (`noise=…:allf=t+u:all_seed=…`, the `grade.grain` preset) draws its temporal pattern
// from a stream that advances once per processed frame, not from the frame's timestamp. Rendering frames
// 30..59 on their own therefore yields different grain than the same frames inside a whole render. The
// engine never splits a section (the cache works on whole sections), so this is fine today; it is the
// constraint any future chunked render must respect.
describe('seeded grain and frame order', () => {
  it('depends on how many frames the filter has processed', () => {
    const whole = path.join(keepDir, 'grain-whole.mkv');
    const chunk = path.join(keepDir, 'grain-chunk.mkv');
    const source = 'color=c=0x808080:s=160x90:r=30:d=2';
    const grain = 'noise=alls=8:allf=t+u:all_seed=7';
    const encode = ['-c:v', 'ffv1', '-pix_fmt', 'yuv420p'];

    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', source, '-vf', grain, ...encode, whole]);
    const trimmed = `trim=start_frame=30,setpts=PTS-STARTPTS,${grain}`;
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', source, '-vf', trimmed, ...encode, chunk]);

    const frames = [0, 10, 29];
    const offset = compareFrames(whole, chunk, {
      frames: frames.map((frame) => frame + 30),
      framesB: frames,
      allowFrameCountMismatch: true,
    });
    const aligned = compareFrames(whole, chunk, { frames, framesB: frames, allowFrameCountMismatch: true });

    // Same timestamps, different grain; same position in the stream, same grain.
    expect(offset.failing).toHaveLength(frames.length);
    expect(aligned.failing).toEqual([]);
  });
});
