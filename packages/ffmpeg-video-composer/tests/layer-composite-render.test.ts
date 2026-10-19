import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { compile } from '@/index';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import { TemplateValidator } from '@/services/TemplateValidator';
import { testBuildDir } from './fixtures/build-dir';

// A rounded grey card multiplied over a #404040 ground, and a white 40 px box crossing at 600 px/s with a
// 180° shutter, rendered through real FFmpeg and read back frame by frame.

const W = 640;
const H = 360;
const here = path.dirname(fileURLToPath(import.meta.url));
const libDir = path.resolve(here, '../../leclap-creative-kit/src/library');
const buildDir = testBuildDir('layer-composite-render');
const media = path.join(buildDir, 'media');

const descriptor = {
  global: { orientation: 'landscape', fps: 30, musicEnabled: false },
  sections: [
    {
      name: 'stage',
      type: 'color_background',
      options: { backgroundColor: '#404040', duration: 2 },
      inputs: [
        {
          name: 'ink',
          type: 'html',
          html: '<div class="c"></div>',
          css: '.c { width: 200px; height: 120px; border-radius: 40px; background: #C0C0C0; }',
          width: 200,
          height: 120,
          options: { position: '40:40', blend: 'multiply' },
        },
        {
          name: 'box',
          type: 'html',
          html: '<div class="b"></div>',
          css: '.b { width: 40px; height: 40px; background: #FFFFFF; }',
          width: 40,
          height: 40,
          options: {
            position: '100:240',
            motionBlur: { shutter: 180, samples: 8 },
            animate: {
              x: [
                { t: 0.5, v: '+0' },
                { t: 1, v: '+300' },
              ],
            },
          },
        },
      ],
    },
  ],
} as unknown as TemplateDescriptor;

function configFor(dir: string, userVideoPaths: Record<string, string> = {}): ProjectConfig {
  return {
    buildDir: dir,
    assetsDir: libDir,
    currentLocale: 'en',
    fields: {},
    userVideoPaths,
    audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
    videoConfig: { orientation: 'landscape', scale: `${W}:${H}` },
  } as unknown as ProjectConfig;
}

function frame(file: string, n: number, format: 'rgb24' | 'gray'): Buffer {
  return execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      file,
      '-vf',
      `select=eq(n\\,${n})`,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      format,
      'pipe:1',
    ],
    { maxBuffer: W * H * 4 }
  );
}

// The box row (y = 260): lit columns (luma > 100) and partially covered ones (100 < luma < 230).
function boxRow(file: string, n: number): { first: number; last: number; partial: number } {
  const row = frame(file, n, 'gray').subarray(260 * W, 261 * W);
  const lit = [...row.keys()].filter((x) => row[x] > 100);

  return { first: lit[0], last: lit.at(-1) as number, partial: lit.filter((x) => row[x] < 230).length };
}

describe('layer blend and motion blur real render', () => {
  it('multiplies inside the card only and smears the box only while it moves', async () => {
    expect(new TemplateValidator().validateTemplate(descriptor).errors ?? []).toEqual([]);

    const output = (await compile(configFor(buildDir), descriptor)) as string;

    expect(output).not.toBeNull();

    const rgb = frame(output, 10, 'rgb24');
    const px = (x: number, y: number) => rgb[(y * W + x) * 3 + 1];

    // Multiply: 64 × 192 / 255 = 48 in the card, the ground untouched in its transparent corner and outside.
    expect(Math.abs(px(140, 100) - 48)).toBeLessThanOrEqual(4);
    expect(Math.abs(px(42, 42) - 64)).toBeLessThanOrEqual(4);
    expect(Math.abs(px(400, 60) - 64)).toBeLessThanOrEqual(4);

    // At rest before and after the move: the sharp 40 px box.
    const before = boxRow(output, 9);
    const after = boxRow(output, 45);

    expect(before.last - before.first + 1).toBeGreaterThanOrEqual(39);
    expect(before.last - before.first + 1).toBeLessThanOrEqual(41);
    expect(before.partial).toBeLessThanOrEqual(4);
    expect(Math.abs((after.first + after.last) / 2 - 420)).toBeLessThanOrEqual(2);
    expect(after.partial).toBeLessThanOrEqual(4);

    // Mid-move (20 px per frame, half of it exposed): a ~50 px streak with soft ends.
    const moving = boxRow(output, 23);

    expect(moving.last - moving.first + 1).toBeGreaterThanOrEqual(46);
    expect(moving.last - moving.first + 1).toBeLessThanOrEqual(54);
    expect(moving.partial).toBeGreaterThanOrEqual(8);
  }, 180000);
});

describe('motion blur on a span at the end of its section', () => {
  // A span that starts late used to make ffmpeg queue every earlier base frame (the closing overlay waits for
  // the blurred branch): the branch is now padded back to t=0 and the overlay gated, and the picture around
  // the span must be unchanged.
  const lateDescriptor = {
    global: { orientation: 'landscape', fps: 30, musicEnabled: false },
    sections: [
      {
        name: 'stage',
        type: 'color_background',
        options: { backgroundColor: '#404040', duration: 3 },
        inputs: [
          {
            name: 'box',
            type: 'html',
            html: '<div class="b"></div>',
            css: '.b { width: 40px; height: 40px; background: #FFFFFF; }',
            width: 40,
            height: 40,
            options: {
              position: '100:240',
              motionBlur: { shutter: 180, samples: 8 },
              animate: {
                x: [
                  { t: 2.4, v: '+0' },
                  { t: 2.9, v: '+300' },
                ],
              },
            },
          },
        ],
      },
    ],
  } as unknown as TemplateDescriptor;

  it('renders the late span blurred and everything else sharp', async () => {
    const dir = path.join(buildDir, 'late');
    const output = (await compile(configFor(dir), lateDescriptor)) as string;

    expect(output).not.toBeNull();

    const before = boxRow(output, 30);
    const moving = boxRow(output, 77);
    const after = boxRow(output, 89);

    expect(before.last - before.first + 1).toBeGreaterThanOrEqual(39);
    expect(before.last - before.first + 1).toBeLessThanOrEqual(41);
    expect(before.partial).toBeLessThanOrEqual(4);
    expect(moving.last - moving.first + 1).toBeGreaterThanOrEqual(46);
    expect(moving.partial).toBeGreaterThanOrEqual(8);
    expect(Math.abs((after.first + after.last) / 2 - 420)).toBeLessThanOrEqual(2);
    expect(after.partial).toBeLessThanOrEqual(4);
  }, 180000);
});

describe('motion blur over a video base at another frame rate', () => {
  const rates = [
    { source: 25, section: 30 },
    { source: 30, section: 25 },
  ];

  beforeAll(() => {
    fs.mkdirSync(media, { recursive: true });

    for (const { source } of rates) {
      execFileSync('ffmpeg', [
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        `testsrc2=s=${W}x${H}:r=${source}:d=2`,
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        path.join(media, `moving-${source}.mp4`),
      ]);
    }
  });

  function videoTemplate(fps: number, motionBlur: boolean): TemplateDescriptor {
    return {
      global: { orientation: 'landscape', fps, musicEnabled: false },
      sections: [
        {
          name: 'shot',
          type: 'project_video',
          options: {},
          inputs: [
            {
              name: 'box',
              type: 'html',
              html: '<div class="b"></div>',
              css: '.b { width: 40px; height: 40px; background: #FFFFFF; }',
              width: 40,
              height: 40,
              options: {
                position: '100:300',
                ...(motionBlur ? { motionBlur: { shutter: 180, samples: 8 } } : {}),
                animate: {
                  x: [
                    { t: 0.5, v: '+0' },
                    { t: 1, v: '+300' },
                  ],
                },
              },
            },
          ],
        },
      ],
    } as unknown as TemplateDescriptor;
  }

  // The picture above the box's path must be the same frame with or without the blur, whatever the source
  // rate: the blurred base copy is cut on the same clock as the sharp one. Neighbouring frames of this
  // source differ by about 1.7 grey levels there, so a one-frame slip cannot hide under the bound.
  it.each(rates)(
    'keeps the base on the sharp frame, $source fps footage in a $section fps section',
    async (rate) => {
      const clip = path.join(media, `moving-${rate.source}.mp4`);
      const sharpDir = path.join(buildDir, `sharp-${rate.source}-${rate.section}`);
      const blurDir = path.join(buildDir, `blur-${rate.source}-${rate.section}`);
      const sharp = (await compile(configFor(sharpDir, { shot: clip }), videoTemplate(rate.section, false))) as string;
      const blurred = (await compile(configFor(blurDir, { shot: clip }), videoTemplate(rate.section, true))) as string;

      expect(sharp).not.toBeNull();
      expect(blurred).not.toBeNull();

      for (const n of [16, 20, 23, 26]) {
        const a = frame(sharp, n, 'gray').subarray(0, 200 * W);
        const b = frame(blurred, n, 'gray').subarray(0, 200 * W);
        const diff = a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0) / a.length;

        expect(diff, `frame ${n}`).toBeLessThan(0.5);
      }

      // The blur is really there: where the box is crossing, the two renders differ.
      const crossing = (file: string) => frame(file, 23, 'gray').subarray(300 * W, 340 * W);
      const sharpBand = crossing(sharp);
      const blurBand = crossing(blurred);
      const changed = sharpBand.reduce((count, value, i) => count + (Math.abs(value - blurBand[i]) > 8 ? 1 : 0), 0);

      expect(changed).toBeGreaterThan(100);
    },
    240000
  );
});
