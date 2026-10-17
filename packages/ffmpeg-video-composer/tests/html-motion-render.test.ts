import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { compile } from '@/index';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import { testBuildDir } from './fixtures/build-dir';

const execFileAsync = promisify(execFile);

// Real compile of an animated HTML card: three dots fading in 0.6 s apart, drawn as an animated PNG and
// composited by the overlay path, holding the final frame after the sequence ends.
const here = path.dirname(fileURLToPath(import.meta.url));
const libDir = path.resolve(here, '../../leclap-creative-kit/src/library');
const buildDir = testBuildDir('html-motion-render');

afterAll(() => {
  fs.rmSync(buildDir, { recursive: true, force: true });
});

async function averageRed(filePath: string, atSeconds: number, crop: string): Promise<number> {
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

  return (stdout as unknown as Buffer)[0];
}

describe('animated html card, real compile', () => {
  it('fades the dots in one after another and holds the last frame', async () => {
    const descriptor = {
      global: { orientation: 'landscape', musicEnabled: false },
      sections: [
        {
          name: 'dots',
          type: 'color_background',
          options: { backgroundColor: '#000000', duration: 3 },
          inputs: [
            {
              name: 'row',
              type: 'html',
              html:
                '<div class="row"><div class="dot" data-motion="dot"></div><div class="dot" data-motion="dot"></div>' +
                '<div class="dot" data-motion="dot"></div></div>',
              css: '.row { display: flex } .dot { width: 100px; height: 100px; background: #ff0000 }',
              width: 400,
              height: 200,
              options: { position: '200:200' },
              motion: {
                dot: {
                  opacity: [
                    { t: 0.5, v: 0 },
                    { t: 0.7, v: 1 },
                  ],
                  stagger: 0.6,
                },
              },
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
      userVideoPaths: {},
    } as unknown as ProjectConfig;

    const out = await compile(projectConfig, descriptor);

    expect(out, 'the animated card template should compile').not.toBeNull();

    const staged = fs.readdirSync(path.join(buildDir, 'panels')).filter((file) => file.endsWith('.apng'));

    expect(staged).toHaveLength(1);

    const dots = ['40:40:230:230', '40:40:330:230', '40:40:430:230'];
    const early = await Promise.all(dots.map((crop) => averageRed(out as string, 0.2, crop)));
    const middle = await Promise.all(dots.map((crop) => averageRed(out as string, 1.0, crop)));
    const held = await Promise.all(dots.map((crop) => averageRed(out as string, 2.6, crop)));

    expect(early.every((red) => red < 30)).toBe(true);
    expect(middle[0]).toBeGreaterThan(200);
    expect(middle[1]).toBeLessThan(30);
    expect(middle[2]).toBeLessThan(30);
    expect(held.every((red) => red > 200)).toBe(true);
  }, 120_000);

  it('starts the dots when the layer appears, not at the section start', async () => {
    const dotMotion = {
      opacity: [
        { t: 0.5, v: 0 },
        { t: 0.7, v: 1 },
      ],
      stagger: 0.6,
    };
    const descriptor = {
      global: { orientation: 'landscape', musicEnabled: false },
      sections: [
        {
          name: 'late',
          type: 'color_background',
          options: { backgroundColor: '#000000', duration: 4 },
          inputs: [
            {
              name: 'row',
              type: 'html',
              html: '<div class="dot" data-motion="dot"></div>',
              css: '.dot { width: 100px; height: 100px; background: #ff0000 }',
              width: 100,
              height: 100,
              options: { position: '200:200', start: 1 },
              motion: { dot: dotMotion },
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
      userVideoPaths: {},
    } as unknown as ProjectConfig;

    const out = await compile(projectConfig, descriptor);

    expect(out, 'the late card template should compile').not.toBeNull();

    const crop = '40:40:230:230';

    expect(await averageRed(out as string, 1.2, crop)).toBeLessThan(30);
    expect(await averageRed(out as string, 3.0, crop)).toBeGreaterThan(200);
  }, 120_000);

  it('lands a time reference on its section moment when the layer starts late', async () => {
    const descriptor = {
      global: { orientation: 'landscape', musicEnabled: false },
      sections: [
        {
          name: 'ref',
          type: 'color_background',
          options: { backgroundColor: '#000000', duration: 4 },
          inputs: [
            {
              name: 'card',
              type: 'html',
              html: '<div class="dot" data-motion="dot"></div>',
              css: '.dot { width: 100px; height: 100px; background: #ff0000 }',
              width: 100,
              height: 100,
              options: { position: '200:200', start: 1 },
              motion: {
                dot: {
                  opacity: [
                    { t: 0, v: 0 },
                    { t: 'end - 2', v: 1 },
                  ],
                },
              },
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
      userVideoPaths: {},
    } as unknown as ProjectConfig;

    const out = await compile(projectConfig, descriptor);

    expect(out, 'the time reference template should compile').not.toBeNull();

    const crop = '40:40:230:230';

    // "end - 2" is the section's 2.0 s mark: the fade is under way at 1.5 s and complete by 2.2 s (it used to finish at 3.0 s).
    expect(await averageRed(out as string, 1.5, crop)).toBeLessThan(200);
    expect(await averageRed(out as string, 2.2, crop)).toBeGreaterThan(235);
  }, 120_000);
});
