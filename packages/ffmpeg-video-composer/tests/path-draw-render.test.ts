import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { compile } from '@/index';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import { TemplateValidator } from '@/services/TemplateValidator';
import { flatten, pointAt, shapeCommands, traceOf } from '@/editor/presets/path-geometry';
import { testBuildDir } from './fixtures/build-dir';

const execFileAsync = promisify(execFile);

// A white wave draws on over black in 1 s (30 frames, linear) with a red head dot. Read back from the
// rendered frames: how much of the path is lit, sampled along its arc length, and where the red dot sits.

const buildDir = testBuildDir('path-draw-render');
const [WIDTH, HEIGHT, FPS] = [1280, 720, 30];
const AT = 0.5;
const WAVE = { type: 'wave', x: 240, y: 360, width: 800, amplitude: 120, wavelength: 400 } as const;
const traced = traceOf(flatten(shapeCommands(WAVE)));

function template(): TemplateDescriptor {
  return {
    global: { orientation: 'landscape', fps: FPS, musicEnabled: false },
    sections: [
      {
        name: 'draw',
        type: 'color_background',
        options: { backgroundColor: '#000000', duration: 2 },
        graphics: [
          {
            type: 'path',
            shape: WAVE,
            at: AT,
            duration: 1,
            ease: 'linear',
            thickness: 8,
            color: '#ffffff',
            exit: 'none',
            head: { size: 20, color: '#ff0000' },
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
  const i = (Math.round(y) * WIDTH + Math.round(x)) * 3;

  return [frame[i], frame[i + 1], frame[i + 2]];
}

// Share of 1000 points evenly spaced along the path that are lit (stroke or head).
function drawnShare(frame: Buffer): { share: number; last: number } {
  const samples = Array.from({ length: 1000 }, (_, i) => (i + 0.5) / 1000);
  const lit = samples.filter((f) => {
    const p = pointAt(traced, f);

    return Math.max(...rgb(frame, p.x, p.y)) > 100;
  });

  return { share: lit.length / samples.length, last: lit.at(-1) ?? 0 };
}

// Centroid of the red pixels (the head dot).
function redCentroid(frame: Buffer): { x: number; y: number; n: number } {
  const sum = { x: 0, y: 0, n: 0 };

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const [r, g, b] = rgb(frame, x, y);

      if (r < 150 || g > 90 || b > 90) continue;

      sum.x += x;
      sum.y += y;
      sum.n += 1;
    }
  }

  return { x: sum.x / sum.n, y: sum.y / sum.n, n: sum.n };
}

describe('path graphic real render', () => {
  it('draws half the arc length at half the duration, with the head on the drawing end', async () => {
    const descriptor = template();
    const validation = new TemplateValidator().validateTemplate(descriptor);

    expect(validation.errors ?? []).toEqual([]);

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

    // Before `at`: nothing.
    expect(drawnShare(await frameAt(output, 0.2)).share).toBe(0);

    // Entrance frame f shows progress (f + 1) / 30: frame 14 is exactly half (-ss picks the first frame at
    // or after the time, so seek just before it).
    const half = await frameAt(output, AT + 14 / FPS - 0.002);
    const drawn = drawnShare(half);
    const head = redCentroid(half);
    const expected = pointAt(traced, 0.5);

    expect(Math.abs(drawn.share - 0.5)).toBeLessThan(0.02);
    expect(Math.abs(drawn.last - 0.5)).toBeLessThan(0.02);
    expect(head.n).toBeGreaterThan(150);
    expect(Math.hypot(head.x - expected.x, head.y - expected.y)).toBeLessThan(2.5);

    // Settled: the whole path, the head at its end.
    const settled = await frameAt(output, 1.8);
    const end = pointAt(traced, 1);
    const settledHead = redCentroid(settled);

    expect(drawnShare(settled).share).toBeGreaterThan(0.99);
    expect(Math.hypot(settledHead.x - end.x, settledHead.y - end.y)).toBeLessThan(2.5);
  }, 240000);
});
