import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compile } from '@/index';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import { testBuildDir } from './fixtures/build-dir';

const execFileAsync = promisify(execFile);

// A muted project_video prepends a blank-audio input, so the recorded clip is input 1, not 0. The overlay
// graph of its layers (an HTML layer, an image) used to read the video from input 0, the audio-only
// anullsrc, and the section failed with "Stream specifier ':v' … matches no streams".
const here = path.dirname(fileURLToPath(import.meta.url));
const libDir = path.resolve(here, '../../leclap-creative-kit/src/library');
const buildDir = testBuildDir('project-video-mute-layers');
const clipDir = testBuildDir('project-video-mute-layers-clip');

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

describe('muted project_video with layers, real compile', () => {
  it('composites an HTML layer over the recorded clip, not over the silent audio input', async () => {
    const clip = await makeClip();
    const descriptor = {
      global: { orientation: 'landscape', musicEnabled: false },
      sections: [
        {
          name: 'recording',
          type: 'project_video',
          options: { muteSection: true, duration: 2 },
          inputs: [
            {
              name: 'badge',
              type: 'html',
              html: '<div class="badge">Live</div>',
              css: '.badge { display: flex; width: 100%; height: 100%; background: #ff2e4d; color: #ffffff; font: 600 40px Rubik }',
              width: 300,
              height: 150,
              options: { position: '100:100' },
            },
          ],
        },
      ],
    } as unknown as TemplateDescriptor;
    const projectConfig = {
      buildDir,
      assetsDir: libDir,
      currentLocale: 'en',
      audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
      videoConfig: { orientation: 'landscape', scale: '1280:720' },
      fields: {},
      userVideoPaths: { recording: clip },
    } as unknown as ProjectConfig;

    const out = await compile(projectConfig, descriptor);

    expect(out, 'the muted section with an HTML layer should compile').not.toBeNull();

    const inside = await averageRgb(out as string, 1, '40:40:320:180');
    const outside = await averageRgb(out as string, 1, '40:40:900:500');

    expect(inside[0]).toBeGreaterThan(200);
    expect(outside.every((channel) => channel < 30)).toBe(true);
  }, 120_000);
});
