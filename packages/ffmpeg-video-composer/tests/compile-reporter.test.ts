import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import { compile, container, loadConfig } from '@/index';
import type { CompileReporter, ProjectConfig, TemplateDescriptor } from '@/core/types';
import type AbstractFFmpeg from '@/platform/ffmpeg/AbstractFFmpeg';
import { testBuildDir } from './fixtures/build-dir';

// The Node `compile()` accepts an optional reporter so a host (the `leclap` CLI) can render live
// progress and tee the engine's logs. This proves the wiring end to end on real ffmpeg with the
// cheapest fixture (a single color_background card — no user video, no music): the reporter must see
// monotonic 0..1 progress reaching 1 and at least one forwarded log line.
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const libDir = path.resolve(repoRoot, 'packages/leclap-creative-kit/src/library');
const fixturesDir = path.resolve(here, 'fixtures');
const buildDir = testBuildDir('compile-reporter');

function load(id: string): TemplateDescriptor {
  return JSON.parse(fs.readFileSync(path.resolve(fixturesDir, `${id}.json`), 'utf8')) as TemplateDescriptor;
}

function projectConfig(): ProjectConfig {
  return {
    buildDir,
    assetsDir: libDir,
    currentLocale: 'en',
    audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
    videoConfig: { orientation: 'landscape', scale: '1280:720' },
    fields: {},
    userVideoPaths: {},
  } as unknown as ProjectConfig;
}

// Filter types are passed to FFmpeg verbatim, so an unknown one is schema-valid and only fails when the
// director renders the segment: the failure happens inside construct(), past compile()'s own checks.
const unknownFilterDescriptor = {
  global: { orientation: 'landscape', musicEnabled: false },
  sections: [
    {
      type: 'color_background',
      name: 'card',
      options: { duration: 1, backgroundColor: '#204060' },
      filters: [{ type: 'definitelynotafilter', value: 1 }],
    },
  ],
} as unknown as TemplateDescriptor;

describe('compile() reporter', () => {
  it('cancels the build when the reporter signal is aborted', async () => {
    const controller = new AbortController();
    const errors: Error[] = [];
    controller.abort();

    const out = await compile(projectConfig(), load('gradient'), {
      signal: controller.signal,
      onError: (error) => errors.push(error),
    });

    expect(out).toBeNull();
    expect(errors).toEqual([]);
  }, 60000);

  it('forwards 0..1 progress and engine log lines', async () => {
    const descriptor = load('gradient');

    const progress: number[] = [];
    const logs: Array<{ level: string; message: string }> = [];
    const errors: Error[] = [];
    const reporter: CompileReporter = {
      onProgress: (fraction) => progress.push(fraction),
      onLog: (line) => logs.push(line),
      onError: (error) => errors.push(error),
    };

    const out = await compile(projectConfig(), descriptor, reporter);

    expect(out, 'gradient should compile').not.toBeNull();
    expect(errors, 'a successful compile reports no error').toEqual([]);

    // Progress is forwarded, stays within 0..1, never decreases, and reaches completion.
    expect(progress.length).toBeGreaterThan(0);
    expect(Math.min(...progress)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...progress)).toBeLessThanOrEqual(1);
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]);
    }
    expect(Math.max(...progress)).toBeCloseTo(1, 5);

    // Engine log lines are teed to the reporter even though the base logger may be quiet.
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some((l) => typeof l.message === 'string' && l.message.length > 0)).toBe(true);
  }, 180000);

  it('compiles unchanged when no reporter is passed', async () => {
    const out = await compile(projectConfig(), load('gradient'));
    expect(out, 'gradient should compile without a reporter').not.toBeNull();
  }, 180000);

  it('hands the reason a render failed inside the director to onError', async () => {
    const errors: Error[] = [];

    const out = await compile(projectConfig(), unknownFilterDescriptor, { onError: (error) => errors.push(error) });

    expect(out, 'compile() still resolves null on failure').toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('FFmpeg command failed');
    // FFmpeg's own stderr names the filter it rejected: the detail a host needs to fix the template.
    expect(errors[0].message).toContain('definitelynotafilter');
    // The reason is FFmpeg's error, not its version banner.
    expect(errors[0].message).not.toMatch(/ffmpeg version|configuration:/);
  }, 180000);

  it('hands onError an Error even when the render rejected with something else', async () => {
    // loadConfig initialises the platform, so the adapter resolved here is the one the director uses.
    await loadConfig(path.resolve(fixturesDir, 'gradient.json'));
    const adapter = container.resolve<AbstractFFmpeg>('ffmpegAdapter');
    const execute = vi.spyOn(adapter, 'execute').mockRejectedValue('ffmpeg exited without a message');
    const errors: unknown[] = [];

    try {
      await compile(projectConfig(), load('gradient'), { onError: (error) => errors.push(error) });
    } finally {
      execute.mockRestore();
    }

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
    expect((errors[0] as Error).message).toBe('ffmpeg exited without a message');
  }, 180000);
});
