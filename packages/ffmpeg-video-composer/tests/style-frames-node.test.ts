import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  analyzeStyleFile,
  extractStyleFrames,
  parseBannerDuration,
  parseOutputSize,
  sampleRateFor,
} from '@/services/style-frames-node';

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });

    return true;
  } catch {
    return false;
  }
}

describe('style frame parsing', () => {
  it('reads the banner duration and the rawvideo output size', () => {
    expect(parseBannerDuration('  Duration: 00:01:02.50, start: 0')).toBe(62.5);
    expect(parseBannerDuration('  Duration: N/A, bitrate: N/A')).toBeNull();
    expect(
      parseOutputSize(
        'Input #0 ... Video: h264, 1920x1080\nOutput #0, rawvideo, to pipe:1:\n  Stream #0:0: Video: rawvideo (RGB[24] / 0x18424752), rgb24(pc, progressive), 160x90, q=2-31'
      )
    ).toEqual({ width: 160, height: 90 });
  });

  it('samples every 0.25 s, or evenly when that exceeds the frame budget', () => {
    expect(sampleRateFor(10, 240)).toBe(4);
    expect(sampleRateFor(120, 240)).toBe(2);
  });
});

describe.skipIf(!hasFfmpeg())('extractStyleFrames (ffmpeg)', () => {
  let dir: string;
  let image: string;
  let clip: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'leclap-style-'));
    image = path.join(dir, 'poster.png');
    clip = path.join(dir, 'cuts.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x203048:s=320x180', '-frames:v', '1', image]);
    // Three 2 s shots: two flat colours and a test pattern, hard-cut together.
    const shots = [
      'color=c=0x203048:s=320x180:r=25:d=2',
      'color=c=0xe0a020:s=320x180:r=25:d=2',
      'testsrc=s=320x180:r=25:d=2',
    ];
    execFileSync('ffmpeg', [
      '-v',
      'error',
      ...shots.flatMap((s) => ['-f', 'lavfi', '-i', s]),
      '-filter_complex',
      '[0][1][2]concat=n=3:v=1:a=0',
      '-pix_fmt',
      'yuv420p',
      clip,
    ]);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('decodes an image as one downscaled rgb24 frame', async () => {
    const decoded = await extractStyleFrames(image, { ffmpeg: 'ffmpeg' });

    expect(decoded.kind).toBe('image');
    expect(decoded.frames).toHaveLength(1);
    expect(decoded.frames[0]).toMatchObject({ width: 160, height: 90, channels: 3 });
    expect(decoded.frames[0].data.length).toBe(160 * 90 * 3);
  });

  it('decodes a clip every 0.25 s with frame times', async () => {
    const decoded = await extractStyleFrames(clip, { ffmpeg: 'ffmpeg' });

    expect(decoded.kind).toBe('clip');
    expect(decoded.duration).toBeCloseTo(6, 1);
    expect(decoded.frames.length).toBeGreaterThanOrEqual(23);
    expect(decoded.frames[4].time).toBe(1);
  });

  it('analyses the clip: two cuts, deterministic theme', async () => {
    const first = await analyzeStyleFile(clip, { ffmpeg: 'ffmpeg' });
    const second = await analyzeStyleFile(clip, { ffmpeg: 'ffmpeg' });

    expect(first).toEqual(second);
    expect(first.styleGuide.pacing?.cuts).toBe(2);
    expect(first.styleGuide.pacing?.avgShot).toBeCloseTo(2, 1);
    expect(first.theme.motion?.beat).toBeGreaterThan(0);
  });

  it('rejects a file with no video stream', async () => {
    const audio = path.join(dir, 'tone.wav');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=d=0.5', audio]);

    await expect(extractStyleFrames(audio, { ffmpeg: 'ffmpeg' })).rejects.toThrow(/No video stream/);
  });
});
