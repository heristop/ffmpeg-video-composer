import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compile, container, loadConfig } from '@/index';
import type { ProjectConfig, SectionOptions, TemplateDescriptor } from '@/core/types';
import type { RenderManifest } from '@/core/determinism/manifest';
import type AbstractFFmpeg from '@/platform/ffmpeg/AbstractFFmpeg';
import type Project from '@/core/models/Project';
import { DryRunFFmpeg } from './fixtures/dry-run-ffmpeg';
import { testBuildDir } from './fixtures/build-dir';

// Footage editing lowering snapshots (reframe, clip range, speed ramp, freeze): the exact commands each
// option compiles to, through the real director with a dry-run adapter (every probe: a 5 s clip with
// sound). Refresh with `vp test run tests/footage-compile.test.ts -u` and review the diff like code.

const here = path.dirname(fileURLToPath(import.meta.url));
const templatesDir = path.resolve(here, '../../leclap-creative-kit/src/templates');
const buildDir = testBuildDir('footage-compile');

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

interface Compiled {
  commands: string;
  durations: Record<string, number>;
  qcDuration: number | undefined;
}

async function compiled(template: TemplateDescriptor, extra: Partial<ProjectConfig> = {}): Promise<Compiled> {
  const config = {
    buildDir,
    currentLocale: 'en',
    userVideoPaths: { clip: '/media/clip.mp4' },
    audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
    videoConfig: { orientation: 'landscape', scale: '1280:720' },
    skipValidation: true,
    ...extra,
  } as unknown as ProjectConfig;
  let manifest: RenderManifest | undefined;
  const project = container.resolve<Project>('project');
  let durations: Record<string, number> = {};
  let qcDuration: number | undefined;
  const output = await compile(config, template, {
    // Build state resets when the compile settles; read the planned lengths while segments render.
    onProgress: () => {
      durations = { ...project.buildInfos.durations };
      qcDuration = project.qcExpectations?.durationSeconds;
    },
    onManifest: (m) => (manifest = m),
  });

  expect(output).not.toBeNull();

  return { commands: `${(manifest as RenderManifest).graph.commands.join('\n')}\n`, durations, qcDuration };
}

function clip(options: SectionOptions, extra: Record<string, unknown> = {}): TemplateDescriptor {
  return {
    global: { orientation: 'landscape', fps: 30, musicEnabled: false },
    sections: [{ name: 'clip', type: 'project_video', options: { duration: 10, ...options }, ...extra }],
  } as unknown as TemplateDescriptor;
}

const CASES: Record<string, SectionOptions> = {
  'fit-blur': { fit: 'blur' },
  'fit-blur-fill': { fit: 'blur', fill: { blur: 32, dim: 0.3, zoom: 1.2 } },
  'focus-left': { focus: 'left' },
  'focus-point': { focus: { x: 0.3, y: 0.2 } },
  'focus-keys': {
    focus: [
      { t: 0, x: 0.2, y: 0.5 },
      { t: 2, x: 0.8, y: 0.5, ease: 'ease-in-out' },
    ],
  },
  'clip-range': { clip: { from: 1, to: 3.5 } },
  'ramp-hero': { speedRamp: 'hero' },
  'ramp-keys': {
    speedRamp: [
      { at: 1, speed: 1 },
      { at: 1.5, speed: 0.5, ease: 'ease-out' },
      { at: 3, speed: 2 },
    ],
  },
  'ramp-mute': { speedRamp: 'flash-in', rampAudio: 'mute' },
  freeze: { freeze: [{ at: 1, hold: 0.5, flash: true }] },
  'freeze-continue': { clip: { from: 0.5 }, freeze: [{ at: 2, hold: 1, audio: 'continue' }] },
  combined: {
    fit: 'blur',
    clip: { from: 0.5, to: 4.5 },
    speedRamp: 'bullet',
    freeze: [{ at: 0.5, hold: 0.4 }],
  },
};

describe('footage lowering snapshots', () => {
  for (const [name, options] of Object.entries(CASES)) {
    it(
      name,
      async () => {
        const { commands } = await compiled(clip(options));

        await expect(commands).toMatchFileSnapshot(`__goldens__/footage/${name}.txt`);
      },
      60000
    );
  }

  it('lowers on the device profile with allowlisted filters only (no apad/tpad/adelay)', async () => {
    const { commands } = await compiled(clip(CASES.combined), { codecConfig: { videoCodec: 'libopenh264' } });

    expect(commands).toContain('loop=loop=12:size=1:start=15');
    expect(commands).not.toMatch(/\b(apad|tpad|adelay|minterpolate)\b/);
    await expect(commands).toMatchFileSnapshot('__goldens__/footage/combined-device.txt');
  }, 60000);

  it('is deterministic: the same template compiles to the same commands', async () => {
    const first = await compiled(clip(CASES.combined));
    const second = await compiled(clip(CASES.combined));

    expect(second.commands).toBe(first.commands);
  }, 60000);

  it('fit cover / focus center are byte-identical to the legacy default', async () => {
    const legacy = await compiled(clip({}));

    expect((await compiled(clip({ fit: 'cover' }))).commands).toBe(legacy.commands);
    expect((await compiled(clip({ focus: 'center' }))).commands).toBe(legacy.commands);
    expect((await compiled(clip({ fit: 'letterbox' }))).commands).toBe(
      (await compiled(clip({ forceOriginalAspectRatio: true }))).commands
    );
    expect((await compiled(clip({ fit: 'off' }))).commands).toBe(
      (await compiled(clip({ forceAspectRatio: false }))).commands
    );
  }, 60000);
});

describe('footage durations', () => {
  it('records the edited length for the timeline and the output QC', async () => {
    // 5 s probe: clip 1..3.5 = 2.5 s.
    expect((await compiled(clip({ clip: { from: 1, to: 3.5 } }))).durations.clip).toBe(2.5);
    // freeze adds its hold (15 frames at 30 fps).
    const frozen = await compiled(clip({ freeze: [{ at: 1, hold: 0.5 }] }));
    expect(frozen.durations.clip).toBe(5.5);
    expect(frozen.qcDuration).toBe(5.5);
    // a declared duration caps the edited length in QC.
    expect((await compiled(clip({ duration: 3, freeze: [{ at: 1, hold: 0.5 }] }))).qcDuration).toBe(3);
  }, 60000);

  it('times a ramp by integrating its speed: 2 s at 1x then 3 s of source at 2x = 3.5 s', async () => {
    const ramped = await compiled(
      clip({
        speedRamp: [
          { at: 0, speed: 1 },
          { at: 2, speed: 2, ease: 'steps(1, end)' },
        ],
      })
    );

    expect(ramped.durations.clip).toBe(3.5);
  }, 60000);

  it('shifts the next section start and transitions by the edited length', async () => {
    const template = {
      global: { orientation: 'landscape', fps: 30, musicEnabled: false, transition: { type: 'fade', duration: 0.5 } },
      sections: [
        { name: 'clip', type: 'project_video', options: { clip: { to: 2 } } },
        { name: 'card', type: 'color_background', options: { backgroundColor: '#101014', duration: 2 } },
      ],
    } as unknown as TemplateDescriptor;
    const { durations, qcDuration } = await compiled(template);

    expect(durations).toEqual({ clip: 2, card: 2 });
    expect(qcDuration).toBe(3.5);
  }, 60000);

  it('caps a reused video section at its clip range and retimes its unmuted sound', async () => {
    const template = {
      global: { orientation: 'landscape', fps: 30, musicEnabled: false },
      sections: [
        { name: 'clip', type: 'project_video', options: { duration: 5 } },
        {
          name: 'again',
          type: 'video',
          options: { useVideoSection: 'clip', muteSection: false, duration: 4, clip: { from: 3 } },
        },
      ],
    } as unknown as TemplateDescriptor;
    const { commands, durations } = await compiled(template);

    expect(durations.again).toBe(2);
    expect(commands).toMatch(/-t 2 .*atrim=start=3:end=5,asetpts=PTS-STARTPTS/);
  }, 60000);
});
