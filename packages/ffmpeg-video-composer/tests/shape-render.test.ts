import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { compile } from '@/index';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import { TemplateValidator } from '@/services/TemplateValidator';
import { testBuildDir } from './fixtures/build-dir';

const execFileAsync = promisify(execFile);

// A red five-point star (outer radius 200, inner 100, centred on 640, 360) over black, twice: fading in over
// 0.3 s, then popping in on a linear scale track about its centre. Read back from the rendered frames.

const buildDir = testBuildDir('shape-render');
const [WIDTH, HEIGHT, FPS] = [1280, 720, 30];
const STAR = {
  type: 'shape',
  preset: { type: 'star', points: 5, inner: 0.5 },
  x: 440,
  y: 160,
  width: 400,
  height: 400,
  color: '#ff0000',
};

afterAll(() => {
  fs.rmSync(buildDir, { recursive: true, force: true });
});

function template(): TemplateDescriptor {
  return {
    global: { orientation: 'landscape', fps: FPS, musicEnabled: false, transition: { type: 'cut' } },
    sections: [
      {
        name: 'fade',
        type: 'color_background',
        options: { backgroundColor: '#000000', duration: 1.5 },
        graphics: [{ ...STAR, at: 0.2, duration: 0.3, ease: 'linear' }],
      },
      {
        name: 'pop',
        type: 'color_background',
        options: { backgroundColor: '#000000', duration: 1.5 },
        graphics: [
          {
            ...STAR,
            at: 0.2,
            animate: {
              scale: [
                { t: 0.2, v: 0 },
                { t: 0.8, v: 1, ease: 'linear' },
              ],
            },
          },
        ],
      },
    ],
  } as unknown as TemplateDescriptor;
}

async function frameAt(file: string, seconds: number): Promise<Buffer> {
  const { stdout } = await execFileAsync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-ss',
      String(seconds),
      '-i',
      file,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      'pipe:1',
    ],
    { encoding: 'buffer', maxBuffer: WIDTH * HEIGHT * 4 }
  );

  return stdout as unknown as Buffer;
}

function rgb(frame: Buffer, x: number, y: number): [number, number, number] {
  const i = (y * WIDTH + x) * 3;

  return [frame[i], frame[i + 1], frame[i + 2]];
}

const isRed = ([r, g, b]: [number, number, number]) => r > 200 && g < 60 && b < 60;
const isBlack = ([r, g, b]: [number, number, number]) => Math.max(r, g, b) < 30;

describe('shape graphic real render', () => {
  it('fades a filled star in, then pops one in on a scale track about its centre', async () => {
    const descriptor = template();

    expect(new TemplateValidator().validateTemplate(descriptor).errors ?? []).toEqual([]);

    const config = {
      buildDir,
      currentLocale: 'en',
      fields: {},
      userVideoPaths: {},
      audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
      videoConfig: { orientation: 'landscape', scale: `${WIDTH}:${HEIGHT}` },
    } as unknown as ProjectConfig;
    const output = (await compile(config, descriptor)) as string;

    expect(output).not.toBeNull();

    // Fade section: nothing before `at`; then a solid star, its box corner still black.
    expect(isBlack(rgb(await frameAt(output, 0.1), 640, 360))).toBe(true);

    const settled = await frameAt(output, 1);

    expect(isRed(rgb(settled, 640, 360))).toBe(true);
    expect(isRed(rgb(settled, 640, 175))).toBe(true);
    expect(isBlack(rgb(settled, 450, 170))).toBe(true);

    // Pop section (starts at 1.5 s): halfway through the track the star is half size, its top tip at y 260.
    const half = await frameAt(output, 2);

    expect(isRed(rgb(half, 640, 360))).toBe(true);
    expect(isRed(rgb(half, 640, 300))).toBe(true);
    expect(isBlack(rgb(half, 640, 175))).toBe(true);
    expect(isRed(rgb(await frameAt(output, 2.7), 640, 175))).toBe(true);
  }, 120_000);
});
