import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { compile } from '@/index';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import { testBuildDir } from './fixtures/build-dir';

const execFileAsync = promisify(execFile);

// A muted `video` section (the default) prepends a blank-audio input, so its clip is input 1, not 0. The
// overlay graph of its layers (an HTML layer) used to read the video from input 0, the audio-only anullsrc,
// and the section failed with "Stream specifier ':v' … matches no streams". Real renders, with and
// without the mute, so both clip positions are exercised.
const buildDir = testBuildDir('video-mute-layers');
const clipDir = testBuildDir('video-mute-layers-clip');

async function makeClip(): Promise<string> {
  const clip = path.join(clipDir, 'recorded.mp4');

  fs.mkdirSync(clipDir, { recursive: true });
  await execFileAsync('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=#000000:s=640x360:d=2:r=30',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    '-shortest',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    clip,
  ]);

  return clip;
}

async function averageRgb(filePath: string, atSeconds: number, crop: string): Promise<number[]> {
  const { stdout } = await execFileAsync(
    'ffmpeg',
    [
      '-ss',
      String(atSeconds),
      '-i',
      filePath,
      '-vf',
      `crop=${crop},scale=1:1`,
      '-vframes',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      'pipe:1',
    ],
    { encoding: 'buffer', maxBuffer: 1024 * 1024 }
  );
  const buffer = stdout as unknown as Buffer;

  return [buffer[0], buffer[1], buffer[2]];
}

const badge = {
  name: 'badge',
  type: 'html',
  html: '<div class="badge">Live</div>',
  css: '.badge { display: flex; width: 100%; height: 100%; background: #ff2e4d; color: #ffffff; font: 600 40px Rubik }',
  width: 300,
  height: 150,
  options: { position: '100:100' },
};

async function renderVideoSection(clip: string, options: Record<string, unknown>): Promise<string | null> {
  const descriptor = {
    global: { orientation: 'landscape', musicEnabled: false },
    sections: [{ name: 'clip', type: 'video', options: { videoUrl: clip, duration: 2, ...options }, inputs: [badge] }],
  } as unknown as TemplateDescriptor;
  const projectConfig = {
    buildDir,
    assetsDir: clipDir,
    currentLocale: 'en',
    audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
    videoConfig: { orientation: 'landscape', scale: '1280:720' },
    fields: {},
  } as unknown as ProjectConfig;

  return compile(projectConfig, descriptor);
}

describe('video section with an HTML layer, real compile', () => {
  it.each([
    ['muted by default', {}],
    ['explicitly unmuted', { muteSection: false }],
  ])(
    'composites the layer over the clip (%s)',
    async (_label, options) => {
      const out = await renderVideoSection(await makeClip(), options);

      expect(out, 'the section with an HTML layer should compile').not.toBeNull();

      const inside = await averageRgb(out as string, 1, '40:40:320:180');
      const outside = await averageRgb(out as string, 1, '40:40:900:500');

      expect(inside[0]).toBeGreaterThan(200);
      expect(outside.every((channel) => channel < 30)).toBe(true);
    },
    120_000
  );
});
