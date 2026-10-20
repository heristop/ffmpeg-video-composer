import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { parseEasing } from '@/core/motion';
import { overlayMotionExpr } from '@/editor/utils/input-sources';

// The cheapest real check of how an entrance lands: FFmpeg composites a white square over black with the
// overlay y the engine lowers, and every frame is read back. The square's top row is its position.

const execFileAsync = promisify(execFile);
const [WIDTH, HEIGHT, BOX, FPS] = [320, 240, 40, 30];

async function frames(y: string, seconds: number): Promise<Buffer[]> {
  const { stdout } = await execFileAsync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      `color=black:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=${seconds}`,
      '-f',
      'lavfi',
      '-i',
      `color=white:s=${BOX}x${BOX}:r=${FPS}`,
      '-filter_complex',
      `[0][1]overlay=x=100:y='${y}':eval=frame:shortest=1,format=gray`,
      '-f',
      'rawvideo',
      'pipe:1',
    ],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }
  );
  const size = WIDTH * HEIGHT;
  const out: Buffer[] = [];

  for (let at = 0; at + size <= stdout.length; at += size) out.push(stdout.subarray(at, at + size));

  return out;
}

function top(frame: Buffer): number {
  for (let row = 0; row < HEIGHT; row++) if (frame[row * WIDTH + 120] > 128) return row;

  return -1;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function md5(frame: Buffer): string {
  return createHash('md5').update(frame).digest('hex');
}

function reversals(values: readonly number[]): number {
  let [count, direction] = [0, 0];

  for (let i = 1; i < values.length; i++) {
    const step = Math.sign(values[i] - values[i - 1]);

    if (step !== 0 && direction !== 0 && step !== direction) count++;

    if (step !== 0) direction = step;
  }

  return count;
}

describe('overlay entrance, rendered', () => {
  it('an ease-out rise moves one way and its last frames are identical', async () => {
    const motion = overlayMotionExpr(
      { type: 'rise', delay: 1.55, duration: 0.5, distance: 14, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      '100:100'
    );
    const drawn = await frames(motion.y as string, 2.7);
    const tops = drawn.map(top);
    const tail = drawn.slice(-18).map(md5);

    expect(reversals(tops), tops.join(' ')).toBe(0);
    expect(tops.at(-1)).toBe(100);
    expect(new Set(tail).size, tops.join(' ')).toBe(1);
  }, 30_000);

  it('a spring overshoots, then holds its rest frame once it rings within half a pixel', async () => {
    const [easing, delay] = ['spring(300, 14)', 0.25];
    const curve = parseEasing(easing);
    const motion = overlayMotionExpr({ type: 'rise', delay, distance: 60, easing }, '100:100');
    const drawn = await frames(motion.y as string, 1.6);
    const tops = drawn.map(top);
    const truth = tops.map(
      (_, frame) => 100 + 60 * (1 - curve.fn(clamp01((frame / FPS - delay) / (curve.settle ?? 1))))
    );
    const near = truth.findLastIndex((value) => Math.abs(value - 100) >= 0.5) + 1;
    const tail = drawn.slice(near);

    expect(Math.min(...tops), tops.join(' ')).toBeLessThan(92);
    expect(tail.length).toBeGreaterThan(8);
    expect(new Set(tail.map(md5)).size, tops.join(' ')).toBe(1);
    expect(tops.at(-1)).toBe(100);
  }, 30_000);
});
