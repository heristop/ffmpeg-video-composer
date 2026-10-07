import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { compile } from '@/index';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import type { RenderManifest } from '@/core/determinism/manifest';
import type { QcFinding, QcReport } from '@/core/qc/types';
import { testBuildDir } from './fixtures/build-dir';

// Output QC and the audio fixes on renders with real sound, from media synthesized on the fly (the kit's
// clips and music are LFS objects that a checkout may not have): a phone-style clip whose audio stops
// before its video, a music bed, and a hot tone through the loudnorm true-peak guard.

const buildDir = testBuildDir('render-qc-media');
const assetsDir = path.join(buildDir, 'media');
const clip = path.join(assetsDir, 'short-audio.mp4');

function ffmpeg(args: string[]): void {
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args]);
}

beforeAll(() => {
  fs.mkdirSync(path.join(assetsDir, 'musics'), { recursive: true });
  // 3 s of video, 2.6 s of audio: `-shortest` used to end the segment with the audio.
  const video = ['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=3'];
  const audio = ['-f', 'lavfi', '-i', 'sine=f=330:d=2.6:sample_rate=44100'];
  ffmpeg([...video, ...audio, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clip]);
  // Percussive white-noise bursts: loudnorm's single pass holds -1.5 dBTP on the PCM, but the AAC encode
  // of such transients lands well above it.
  const bursts = "anoisesrc=d=8:c=white:a=0.9:seed=1:r=44100,volume='exp(-30*mod(t,0.25))':eval=frame";
  const mp3 = ['-ac', '2', '-c:a', 'libmp3lame', '-b:a', '192k', path.join(assetsDir, 'musics', 'hot.mp3')];
  ffmpeg(['-f', 'lavfi', '-i', bursts, ...mp3]);
});

const config = {
  buildDir,
  assetsDir,
  currentLocale: 'en',
  audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
  videoConfig: { orientation: 'landscape', scale: '640:360' },
  qc: { content: true },
} as unknown as ProjectConfig;

async function render(
  descriptor: TemplateDescriptor,
  extra: Partial<ProjectConfig> = {}
): Promise<{ qc: QcReport; manifest: RenderManifest }> {
  const captured: { qc?: QcReport; manifest?: RenderManifest; error?: Error } = {};
  const output = await compile({ ...config, ...extra }, descriptor, {
    onQc: (report) => (captured.qc = report),
    onManifest: (manifest) => (captured.manifest = manifest),
    onError: (error) => (captured.error = error),
  });

  expect(captured.error).toBeUndefined();
  expect(output).not.toBeNull();

  return { qc: captured.qc as QcReport, manifest: captured.manifest as RenderManifest };
}

function check(report: QcReport, name: string): QcFinding | undefined {
  return report.findings.find((finding) => finding.check === name);
}

describe('render QC with sound', () => {
  it('keeps every video frame of a clip whose audio ends first', async () => {
    const { qc } = await render(
      {
        meta: { name: 'short-audio' },
        global: { musicEnabled: false },
        sections: [{ type: 'project_video', name: 'clip', options: { duration: 3 } }],
      } as unknown as TemplateDescriptor,
      { userVideoPaths: { clip } }
    );

    expect(check(qc, 'duration')).toMatchObject({ status: 'pass', expected: 3 });
    expect(check(qc, 'frame_count')).toMatchObject({ status: 'pass', value: 90, expected: 90 });
    expect(check(qc, 'av_drift')?.status).toBe('pass');
    expect(check(qc, 'audio_present')).toMatchObject({ status: 'pass', expected: 'present' });
    expect(qc.verified).toBe(true);
  }, 240000);

  it('mixes music to the exact video length and holds the loudnorm true-peak ceiling', async () => {
    const { qc, manifest } = await render({
      meta: { name: 'music-mix' },
      global: { musicEnabled: true, music: { name: 'hot' }, audio: { normalize: 'loudnorm' } },
      sections: [
        { type: 'color_background', name: 'one', options: { backgroundColor: '#204060', duration: 2 } },
        { type: 'color_background', name: 'two', options: { backgroundColor: '#406020', duration: 2 } },
      ],
    } as unknown as TemplateDescriptor);

    expect(check(qc, 'duration')?.status).toBe('pass');
    expect(check(qc, 'frame_count')?.status).toBe('pass');
    expect(check(qc, 'av_drift')?.status).toBe('pass');
    expect(check(qc, 'silence')?.status).toBe('pass');
    // The first pass overshoots after AAC, so the guard re-ran the mix with lower ceilings (at most twice)
    // and recorded every pass. How far the peak drops per pass depends on the encoder, so only the
    // guard's own behaviour is asserted.
    const loudness = manifest.loudness;
    const attempts = loudness?.attempts ?? [];
    const ceilings = attempts.map((attempt) => attempt.ceiling);

    expect(loudness).toMatchObject({ filter: 'loudnorm', target: -1.5, retries: attempts.length - 1 });
    expect(attempts[0]).toMatchObject({ ceiling: -1.5 });
    expect(attempts[0].measured).toBeGreaterThan(-1.4);
    expect(attempts.length).toBeGreaterThan(1);
    expect(attempts.length).toBeLessThanOrEqual(3);
    expect(ceilings).toEqual([...ceilings].sort((a, b) => b - a));
    expect(new Set(ceilings).size).toBe(ceilings.length);
    expect(loudness?.ceiling).toBe(ceilings.at(-1));
    // QC reports the peak the guard ended on, against the requested ceiling (a format finding).
    const settled = (loudness?.measured ?? 0) <= -1.4;
    expect(check(qc, 'true_peak')).toMatchObject({ status: settled ? 'pass' : 'warn', kind: 'format' });
    expect(qc.verified).toBe(settled);
  }, 240000);
});
