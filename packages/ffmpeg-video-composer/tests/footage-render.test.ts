import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { compile } from '@/index';
import type { ProjectConfig, SectionOptions, TemplateDescriptor } from '@/core/types';
import type { QcFinding, QcReport } from '@/core/qc/types';
import { testBuildDir } from './fixtures/build-dir';

// Real renders of footage edits on a synthesized clip (portrait testsrc2 + a tone, 6 s at 30 fps): the
// output QC compares the rendered length, frame count and A/V drift against the planned edited length,
// so a clip range, a ramp or a freeze that the duration math gets wrong fails here.

const buildDir = testBuildDir('footage-render');
const media = path.join(buildDir, 'media');
const clip = path.join(media, 'portrait.mp4');

beforeAll(() => {
  fs.mkdirSync(media, { recursive: true });
  execFileSync('ffmpeg', [
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=360x640:r=30:d=6',
    '-f',
    'lavfi',
    '-i',
    'sine=f=330:d=6:sample_rate=44100',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-ac',
    '2',
    clip,
  ]);
});

const config = {
  buildDir,
  assetsDir: media,
  currentLocale: 'en',
  userVideoPaths: { shot: clip },
  audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
  videoConfig: { orientation: 'landscape', scale: '640:360' },
  qc: { content: true },
} as unknown as ProjectConfig;

async function render(options: SectionOptions): Promise<QcReport> {
  const captured: { qc?: QcReport; error?: Error } = {};
  const descriptor = {
    meta: { name: 'footage' },
    global: { musicEnabled: false, fps: 30 },
    sections: [{ type: 'project_video', name: 'shot', options }],
  } as unknown as TemplateDescriptor;
  const output = await compile(config, descriptor, {
    onQc: (report) => (captured.qc = report),
    onError: (error) => (captured.error = error),
  });

  expect(captured.error).toBeUndefined();
  expect(output).not.toBeNull();

  return captured.qc as QcReport;
}

function check(report: QcReport, name: string): QcFinding | undefined {
  return report.findings.find((finding) => finding.check === name);
}

function expectLength(qc: QcReport, seconds: number): void {
  expect(check(qc, 'duration')).toMatchObject({ status: 'pass', expected: seconds });
  expect(check(qc, 'frame_count')).toMatchObject({ status: 'pass', expected: Math.round(seconds * 30) });
  expect(Math.abs(Number(check(qc, 'frame_count')?.value) - seconds * 30)).toBeLessThanOrEqual(1);
  expect(check(qc, 'av_drift')?.status).toBe('pass');
}

describe('footage edits render to their planned length', () => {
  it('plays only the clip range', async () => {
    expectLength(await render({ clip: { from: 1, to: 4 } }), 3);
  }, 240000);

  it('ramps 1 s at real time, then 2 s of source at half speed (5 s)', async () => {
    const qc = await render({
      clip: { to: 3 },
      speedRamp: [
        { at: 0, speed: 1 },
        { at: 1, speed: 0.5, ease: 'steps(1, end)' },
      ],
    });

    expectLength(qc, 5);
  }, 240000);

  it('holds a frozen frame, with a flash, for its hold', async () => {
    expectLength(await render({ clip: { from: 0.5, to: 3.5 }, freeze: [{ at: 1, hold: 0.5, flash: true }] }), 3.5);
  }, 240000);

  it('renders a blur-fit eased preset ramp to the planned length', async () => {
    const qc = await render({ fit: 'blur', clip: { to: 4 }, speedRamp: 'hero', rampAudio: 'stretch' });
    const planned = Number(check(qc, 'duration')?.expected);

    expect(planned).toBeGreaterThan(4);
    expectLength(qc, planned);
  }, 240000);
});
