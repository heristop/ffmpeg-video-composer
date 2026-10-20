import { describe, expect, it } from 'vitest';
import { easedProgressExpr, parseEasing } from '@/core/motion';
import { overlayMotionExpr } from '@/editor/utils/input-sources';
import { evaluateExpr } from '@/services/geometry/drawtext-expr';

// How an animation ends on screen. The overlay filter truncates its x / y to whole pixels (and to even
// ones on a 4:2:0 main), so a lowered curve that dips a hair past its end, or a spring tail that rings
// around its rest by a fraction of a pixel, flips the layer by a pixel or two on the last frames.

const FPS = 30;

// What FFmpeg's overlay does with the evaluated expression: (int) truncation, then the chroma alignment.
function overlayPixel(value: number, align: boolean): number {
  const whole = Math.trunc(value);

  return align ? whole & ~1 : whole;
}

function evaluate(expr: string, t: number): number {
  const value = evaluateExpr(expr, { t });

  expect(value, `${expr.slice(0, 40)}… at t=${t}`).not.toBeNull();

  return value as number;
}

function overlayYs(expr: string, from: number, to: number, align: boolean): number[] {
  const ys: number[] = [];

  for (let frame = Math.floor(from * FPS); frame <= Math.ceil(to * FPS); frame++) {
    ys.push(overlayPixel(evaluate(expr, frame / FPS), align));
  }

  return ys;
}

function reversals(values: readonly number[]): number {
  let count = 0;
  let direction = 0;

  for (let i = 1; i < values.length; i++) {
    const step = Math.sign(values[i] - values[i - 1]);

    if (step !== 0 && direction !== 0 && step !== direction) count++;

    if (step !== 0) direction = step;
  }

  return count;
}

// Curves that never overshoot: their lowered form must not either, nor turn back on itself.
const MONOTONE = [
  'ease-out-cubic',
  'ease-out-quart',
  'ease-out-quint',
  'ease-out-expo',
  'ease-out-sine',
  'ease-out-circ',
  'ease-in-cubic',
  'ease-in-out-cubic',
  'ease-in-out-sine',
  'ease-in-out-expo',
  'ease',
  'ease-in',
  'cubic-bezier(0.16, 1, 0.3, 1)',
  'cubic-bezier(0.22, 1, 0.36, 1)',
  'spring(100, 20)',
  'spring(100, 60)',
];

describe('lowered monotone curves', () => {
  it.each(MONOTONE)('%s stays inside 0..1 and never turns back', (spec) => {
    const window = { delay: 0.5, duration: 0.5 };
    const expr = easedProgressExpr(parseEasing(spec), window);
    let previous = -Infinity;

    for (let i = 0; i <= 2000; i++) {
      const value = evaluate(expr, window.delay + (i / 2000) * window.duration);

      expect(value, `${spec} at i=${i}`).toBeLessThanOrEqual(1);
      expect(value, `${spec} at i=${i}`).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = value;
    }
  });
});

describe('overlay entrance settle', () => {
  const EXPO = 'cubic-bezier(0.16, 1, 0.3, 1)';

  it.each([true, false])('an ease-out rise lands on its rest pixel and stays there (aligned=%s)', (align) => {
    const motion = overlayMotionExpr(
      { type: 'rise', delay: 1.55, duration: 0.5, distance: 14, easing: EXPO },
      '208:496'
    );
    const ys = overlayYs(motion.y as string, 1.5, 3, align);

    expect(reversals(ys), ys.join(' ')).toBe(0);
    expect(
      ys.slice(ys.indexOf(496)).every((y) => y === 496),
      ys.join(' ')
    ).toBe(true);
  });

  it.each([7, 14, 60, 240])('an ease-out slide of %d px never steps back, on either side of zero', (distance) => {
    for (const base of ['-37', '0', '213']) {
      const motion = overlayMotionExpr(
        { type: 'slide-right', delay: 0.2, duration: 0.6, distance, easing: EXPO },
        `${base}:0`
      );
      const xs = overlayYs(motion.x as string, 0.2, 1.5, false);

      expect(reversals(xs), xs.join(' ')).toBe(0);
      expect(xs.at(-1)).toBe(Number(base));
    }
  });

  it('a spring keeps its overshoot but holds the rest pixel once it rings within half a pixel', () => {
    const easing = 'spring(300, 14)';
    const motion = overlayMotionExpr({ type: 'rise', delay: 0.5, distance: 60, easing }, '100:100');
    const curve = parseEasing(easing);
    const duration = curve.settle as number;
    const frames: Array<{ truth: number; pixel: number }> = [];

    for (let frame = 15; frame <= Math.ceil((0.5 + duration) * FPS) + 10; frame++) {
      const t = frame / FPS;
      const p = Math.min(1, Math.max(0, (t - 0.5) / duration));

      frames.push({ truth: 100 + (1 - curve.fn(p)) * 60, pixel: overlayPixel(evaluate(motion.y as string, t), false) });
    }

    const lastAway = frames.findLastIndex((frame) => Math.abs(frame.truth - 100) >= 0.5);
    const tail = frames.slice(lastAway + 1).map((frame) => frame.pixel);

    expect(Math.min(...frames.map((frame) => frame.pixel))).toBeLessThan(90);
    expect(tail.length).toBeGreaterThan(5);
    expect(
      tail.every((pixel) => pixel === 100),
      tail.join(' ')
    ).toBe(true);
  });
});
