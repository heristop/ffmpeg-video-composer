import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { cameraFilters } from '@/core/motion/camera';
import { designedTransitionGraph } from '@/core/motion/transitions';
import { exactZoomFilters, ZOOM_TIME, type ZoomMove } from '@/core/motion/zoom-exact';
import { DEVICE_FILTERS } from '@/editor/utils/device-filters.generated';
import { CameraSchema } from '@/schemas/camera.schemas';
import { testBuildDir } from './fixtures/build-dir';

// Zoom smoothness on real frames. A dot chart is pushed in through the exact zoom and each dot is tracked
// to a sub-pixel centroid, frame by frame: every frame must move by its own share of the move (no held or
// repeated frame, no backward step), within a few hundredths of a pixel. The whole-pixel zoompan this
// replaced held each dot still for two to four frames on a slow push-in, then jumped by a pixel.

const [W, H, FPS] = [640, 360, 30];
const FRAMES = 60;
const DOTS = [0.12, 0.3, 0.7, 0.88].flatMap((fx) => [0.15, 0.5, 0.85].map((fy) => [fx * W, fy * H] as const));
const dir = testBuildDir('zoom-exact');

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-version'], { stdio: 'pipe' });

    return true;
  } catch {
    return false;
  }
}

// Soft dots (σ 2 px) on a dark field, as a binary PGM.
function writeChart(file: string): void {
  const pixels = Buffer.alloc(W * H, 30);

  for (const [cx, cy] of DOTS) {
    for (let y = Math.floor(cy - 8); y <= cy + 8; y++) {
      for (let x = Math.floor(cx - 8); x <= cx + 8; x++) {
        const value = pixels[y * W + x] + 200 * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / 8);

        pixels[y * W + x] = Math.min(255, Math.round(value));
      }
    }
  }

  fs.writeFileSync(file, Buffer.concat([Buffer.from(`P5 ${W} ${H} 255\n`), pixels]));
}

function render(chart: string, filters: string[]): Buffer[] {
  const raw = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-loop', '1', '-framerate', `${FPS}`, '-t', `${FRAMES / FPS}`, '-i', chart, '-vf'].concat(
      ['format=yuv420p', ...filters, 'format=gray'].join(','),
      ['-f', 'rawvideo', '-']
    ),
    { maxBuffer: 1 << 28 }
  );

  return Array.from({ length: raw.length / (W * H) }, (_, i) => raw.subarray(i * W * H, (i + 1) * W * H));
}

// Sub-pixel centroid of the dot near (px, py), above the field level.
function centroid(frame: Buffer, px: number, py: number): [number, number] {
  let [sum, sx, sy] = [0, 0, 0];
  const [x0, y0] = [Math.round(px), Math.round(py)];

  for (let y = y0 - 6; y <= y0 + 6; y++) {
    for (let x = x0 - 6; x <= x0 + 6; x++) {
      const weight = Math.max(0, frame[y * W + x] - 32);

      [sum, sx, sy] = [sum + weight, sx + weight * x, sy + weight * y];
    }
  }

  return [sx / sum, sy / sum];
}

function track(frames: Buffer[]): [number, number][][] {
  let previous = DOTS.map(([x, y]) => [x, y] as [number, number]);

  return frames.map((frame) => {
    previous = previous.map(([x, y]) => centroid(frame, x, y));

    return previous;
  });
}

// Ease-in-out push 1 → 1.06 over the 2 s: a slow move, the case that used to stutter.
const ZOOM = (t: number) => 1 + 0.06 * (0.5 - 0.5 * Math.cos((Math.PI * Math.min(t, 2)) / 2));
const PUSH: ZoomMove = { zoom: `1+0.06*(0.5-0.5*cos(PI*min(${ZOOM_TIME},2)/2))` };

const ready = hasFfmpeg();

describe('exact zoom graph', () => {
  it('runs on the frame clock, one frame per frame, with on-device filters only', () => {
    const filters = exactZoomFilters(PUSH, { width: W, height: H, fps: FPS });

    expect(filters[0]).toBe('setpts=N/(30*TB)');
    expect(filters.at(-2)).toMatch(/:d=1:s=640x360:fps=30$/);
    expect(filters.every((filter) => DEVICE_FILTERS.has(filter.split('=')[0]))).toBe(true);
    // Both stages read the same restamped clock.
    expect(filters[1]).toContain('cos(PI*min(t,2)/2)');
    expect(filters[3]).toContain('cos(PI*min(it,2)/2)');
  });

  it('rests a moving zoom just above 1, unless it hands over to the untouched picture', () => {
    const frame = { width: W, height: H, fps: FPS };
    const rest = 'st(0,ld(0)+0.004687*pow(max(0,1-(ld(0)-1)/0.05),2))';

    expect(exactZoomFilters(PUSH, frame)[1]).toContain(rest);
    expect(exactZoomFilters(PUSH, frame)[3]).toContain(rest);
    expect(exactZoomFilters(PUSH, { ...frame, identityAtRest: true }).join()).not.toContain('pow(');
    expect(exactZoomFilters({ zoom: '1.15', panX: `10*${ZOOM_TIME}` }, frame).join()).not.toContain('pow(');
  });

  it('is deterministic text', () => {
    const camera = CameraSchema.parse({ preset: 'push-in', amount: 0.09 });
    const frame = { width: 1280, height: 720, fps: 30, duration: 3.5, seed: 4 };

    expect(cameraFilters(camera, frame)).toEqual(cameraFilters(camera, frame));
  });
});

describe.skipIf(!ready)('exact zoom on real frames', () => {
  let frames: Buffer[];
  let positions: [number, number][][];

  beforeAll(() => {
    fs.mkdirSync(dir, { recursive: true });
    const chart = path.join(dir, 'dots.pgm');

    writeChart(chart);
    frames = render(chart, exactZoomFilters(PUSH, { width: W, height: H, fps: FPS }));
    positions = track(frames);
  });

  it('emits one frame per input frame', () => {
    expect(positions).toHaveLength(FRAMES);
  });

  it('moves every dot by its own share of the move each frame: no held, repeated or backward frame', () => {
    const deviations: number[] = [];

    for (const [dot, [cx, cy]] of DOTS.entries()) {
      for (let i = 1; i < FRAMES; i++) {
        const ideal = (t: number) => [W / 2 + (cx - W / 2) * ZOOM(t), H / 2 + (cy - H / 2) * ZOOM(t)];
        const [[ax, ay], [bx, by]] = [ideal((i - 1) / FPS), ideal(i / FPS)];
        const [dx, dy] = [
          positions[i][dot][0] - positions[i - 1][dot][0],
          positions[i][dot][1] - positions[i - 1][dot][1],
        ];
        const step = Math.hypot(bx - ax, by - ay);

        deviations.push(Math.hypot(dx - (bx - ax), dy - (by - ay)));

        // Wherever the dot should visibly move (over 7 px/s), it does, by about its share, forwards. Below
        // that the centroid is too coarse to judge direction (the next test checks no frame is held).
        if (step > 0.25) expect(dx * (bx - ax) + dy * (by - ay)).toBeGreaterThan(0.5 * step * step);
      }
    }

    const rms = Math.sqrt(deviations.reduce((sum, d) => sum + d * d, 0) / deviations.length);

    expect(rms).toBeLessThan(0.08);
  });

  // Near zoom 1 the integer rasters cannot draw a step under 1/max(W,H): an eased push used to hold its
  // first five frames still here, then jump. The rest over-scan gives every frame its step.
  it('holds no frame while the zoom moves, even where the ease leaves rest', () => {
    const held = frames.slice(1).flatMap((frame, i) => (frame.equals(frames[i]) ? [i + 1] : []));

    expect(held).toEqual([]);
  });

  it('lands on the requested zoom', () => {
    const [[x0], [x1]] = [positions.at(-1)?.[0] ?? [0], positions.at(-1)?.[9] ?? [0]];

    expect((x1 - x0) / (DOTS[9][0] - DOTS[0][0])).toBeCloseTo(ZOOM(2), 3);
  });
});

describe.skipIf(!ready)('zoom-through on real frames', () => {
  it('renders the boundary on the frame clock: every frame present, the timeline unchanged', () => {
    const boundary = { left: 'a', right: 'b', out: 'v', id: 'dt0', type: 'zoom-through' } as const;
    const graph = designedTransitionGraph({ ...boundary, offset: 1, duration: 0.5, width: W, height: H, fps: FPS });
    const sources = ['testsrc2', 'smptebars'].flatMap((src) => [
      '-f',
      'lavfi',
      '-i',
      `${src}=s=${W}x${H}:r=${FPS}:d=2`,
    ]);
    const out = execFileSync(
      'ffmpeg',
      ['-v', 'error', ...sources, '-filter_complex', `[0:v]settb=AVTB[a];[1:v]settb=AVTB[b];${graph}`].concat([
        '-map',
        '[v]',
        '-f',
        'framemd5',
        '-',
      ]),
      { encoding: 'utf8' }
    );
    const frames = out.split('\n').filter((line) => line.startsWith('0,'));

    // 1 s head + 0.5 s mix + 1.5 s rest.
    expect(frames).toHaveLength(3 * FPS);
  });
});
