import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { compile } from '@/index';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import { encodePng } from '@/editor/presets/png-encode';
import { TemplateValidator } from '@/services/TemplateValidator';
import { testBuildDir } from './fixtures/build-dir';

const execFileAsync = promisify(execFile);

// A layer's keyframe tracks through real FFmpeg: a solid 200×100 card at rest centred on (640, 360)
// pops in (scale 0 → 1.2 → 1), turns a quarter, slides right, then half fades. Each phase is read back
// from the rendered frames as the bounding box and centroid of the lit pixels.

const buildDir = testBuildDir('layer-keyframes-render');
const WIDTH = 1280;
const HEIGHT = 720;

function solidCard(file: string): void {
  const [w, h] = [200, 100];
  const data = new Uint8Array(w * h * 4);

  for (let i = 0; i < w * h; i++) data.set([255, 255, 255, 255], i * 4);

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encodePng({ width: w, height: h, channels: 4, data }));
}

function template(card: string): TemplateDescriptor {
  return {
    global: { orientation: 'landscape', fps: 30, musicEnabled: false },
    sections: [
      {
        name: 'card',
        type: 'color_background',
        options: { backgroundColor: '#000000', duration: 2.6 },
        inputs: [
          {
            name: 'card',
            type: 'image',
            url: card,
            options: {
              position: '540:310',
              scale: '200:100',
              animate: {
                scale: [{ v: 0 }, { t: 0.5, v: 1.2 }, { t: 0.8, v: 1 }],
                rotate: [{ v: 0 }, { t: 1, v: 0 }, { t: 1.5, v: 90 }],
                x: [{ v: '+0' }, { t: 1.8, v: '+0' }, { t: 2.1, v: '+200' }],
                opacity: [{ v: 1 }, { t: 2.2, v: 1 }, { t: 2.3, v: 0.5 }],
              },
            },
          },
        ],
      },
    ],
  } as unknown as TemplateDescriptor;
}

interface Blob {
  w: number;
  h: number;
  cx: number;
  cy: number;
  /** Mean luma of the lit pixels. */
  level: number;
}

// The lit pixels (luma > 40) of the frame at `seconds`: bounding box, centroid and mean level.
async function blobAt(file: string, seconds: number): Promise<Blob> {
  const { stdout } = await execFileAsync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      file,
      '-ss',
      String(seconds),
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'gray',
      'pipe:1',
    ],
    { encoding: 'buffer', maxBuffer: WIDTH * HEIGHT * 2 }
  );
  const frame = stdout as unknown as Buffer;
  const box = { x0: WIDTH, y0: HEIGHT, x1: -1, y1: -1, sx: 0, sy: 0, n: 0, sum: 0 };

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const luma = frame[y * WIDTH + x];

      if (luma <= 40) continue;

      box.x0 = Math.min(box.x0, x);
      box.x1 = Math.max(box.x1, x);
      box.y0 = Math.min(box.y0, y);
      box.y1 = Math.max(box.y1, y);
      box.sx += x;
      box.sy += y;
      box.n += 1;
      box.sum += luma;
    }
  }

  if (box.n === 0) return { w: 0, h: 0, cx: 0, cy: 0, level: 0 };

  return {
    w: box.x1 - box.x0 + 1,
    h: box.y1 - box.y0 + 1,
    cx: box.sx / box.n,
    cy: box.sy / box.n,
    level: box.sum / box.n,
  };
}

describe('layer keyframes real render', () => {
  it('scales, turns, moves and fades the card about its centre', async () => {
    const card = path.join(buildDir, 'fixtures/card.png');
    solidCard(card);
    const descriptor = template(card);

    expect(new TemplateValidator().validateTemplate(descriptor).errors ?? []).toEqual([]);

    const config = {
      buildDir,
      currentLocale: 'en',
      fields: {},
      userVideoPaths: {},
      audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
      videoConfig: { orientation: 'landscape', scale: '1280:720' },
    } as unknown as ProjectConfig;
    const output = (await compile(config, descriptor)) as string;

    expect(output).not.toBeNull();

    // Pop-in: nothing at the start, 1.2× at the peak, settled at 1× — centre fixed throughout.
    const start = await blobAt(output, 0);
    const peak = await blobAt(output, 0.5);
    const rest = await blobAt(output, 0.9);

    expect(start.w).toBeLessThanOrEqual(4);
    expect(peak.w).toBeGreaterThanOrEqual(236);
    expect(peak.w).toBeLessThanOrEqual(244);
    expect(peak.h).toBeGreaterThanOrEqual(116);
    expect(peak.h).toBeLessThanOrEqual(124);
    expect(rest.w).toBeGreaterThanOrEqual(198);
    expect(rest.w).toBeLessThanOrEqual(202);
    expect(rest.h).toBeGreaterThanOrEqual(98);
    expect(rest.h).toBeLessThanOrEqual(102);

    for (const blob of [peak, rest]) {
      expect(Math.abs(blob.cx - 640)).toBeLessThan(2);
      expect(Math.abs(blob.cy - 360)).toBeLessThan(2);
    }

    // A quarter turn about the centre: the box stands up, the centroid stays put.
    const turned = await blobAt(output, 1.7);

    expect(turned.w).toBeGreaterThanOrEqual(98);
    expect(turned.w).toBeLessThanOrEqual(104);
    expect(turned.h).toBeGreaterThanOrEqual(198);
    expect(turned.h).toBeLessThanOrEqual(204);
    expect(Math.abs(turned.cx - 640)).toBeLessThan(2);
    expect(Math.abs(turned.cy - 360)).toBeLessThan(2);

    // The x track slides it 200 px right; the opacity track halves its level.
    const moved = await blobAt(output, 2.15);
    const faded = await blobAt(output, 2.45);

    expect(Math.abs(moved.cx - 840)).toBeLessThan(2);
    expect(Math.abs(moved.cy - 360)).toBeLessThan(2);
    expect(moved.level).toBeGreaterThan(200);
    expect(Math.abs(faded.cx - 840)).toBeLessThan(2);
    expect(faded.level).toBeGreaterThan(110);
    expect(faded.level).toBeLessThan(145);
  }, 240000);
});
