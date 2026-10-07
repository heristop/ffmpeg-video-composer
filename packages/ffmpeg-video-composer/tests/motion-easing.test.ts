import { describe, expect, it } from 'vitest';
import {
  NAMED_CURVES,
  TOLERANCE,
  easedProgressExpr,
  easingError,
  parseEasing,
  springPosition,
  springSettleTime,
  type SpringParams,
} from '@/core/motion';
import { evaluateExpr } from '@/services/geometry/drawtext-expr';

// Every curve is lowered to a piecewise polynomial in t. These tests evaluate the emitted expression
// with the engine's own FFmpeg-expression evaluator, so they check the string FFmpeg will run.

const WINDOW = { delay: 0.25, duration: 0.8 };

function maxError(spec: string, window = WINDOW): number {
  const curve = parseEasing(spec);
  const expr = easedProgressExpr(curve, window);
  let worst = 0;

  for (let i = 0; i <= 400; i++) {
    const p = i / 400;
    const value = evaluateExpr(expr, { t: window.delay + p * window.duration });

    expect(value, `${spec} at p=${p}`).not.toBeNull();
    worst = Math.max(worst, Math.abs((value as number) - curve.fn(p)));
  }

  return worst;
}

// Independent reference: integrate m·x″ + c·x′ + k·x = 0 with RK4, x(0) = 1, x′(0) = −v0.
function rk4Spring({ stiffness: k, damping: c, mass: m = 1, velocity: v0 = 0 }: SpringParams, seconds: number): number {
  const dt = 1 / 20000;
  let x = 1;
  let v = -v0;
  const accel = (px: number, pv: number) => (-k * px - c * pv) / m;

  for (let t = 0; t < seconds - 1e-12; t += dt) {
    const [k1x, k1v] = [v, accel(x, v)];
    const [k2x, k2v] = [v + (dt / 2) * k1v, accel(x + (dt / 2) * k1x, v + (dt / 2) * k1v)];
    const [k3x, k3v] = [v + (dt / 2) * k2v, accel(x + (dt / 2) * k2x, v + (dt / 2) * k2v)];
    const [k4x, k4v] = [v + dt * k3v, accel(x + dt * k3x, v + dt * k3v)];
    x += (dt / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
    v += (dt / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
  }

  return 1 - x;
}

const SPRINGS: Record<string, SpringParams> = {
  snappy: { stiffness: 420, damping: 30 },
  bouncy: { stiffness: 300, damping: 14 },
  wobbly: { stiffness: 180, damping: 12 },
  critical: { stiffness: 100, damping: 20 },
  overdamped: { stiffness: 100, damping: 60 },
  launched: { stiffness: 250, damping: 18, mass: 1.5, velocity: 8 },
};

describe('spring physics', () => {
  it('matches an independent RK4 integration within 0.002 (P1 exit criterion)', () => {
    for (const [name, spring] of Object.entries(SPRINGS)) {
      for (const seconds of [0.05, 0.1, 0.2, 0.35, 0.5, 0.8, 1.2]) {
        expect(
          Math.abs(springPosition(spring, seconds) - rk4Spring(spring, seconds)),
          `${name} @ ${seconds}s`
        ).toBeLessThan(0.002);
      }
    }
  });

  it('settles within 0.1% at its settle time and stays there', () => {
    for (const spring of Object.values(SPRINGS)) {
      const settle = springSettleTime(spring);

      for (let t = settle; t < settle + 2; t += 0.01) {
        expect(Math.abs(1 - springPosition(spring, t))).toBeLessThan(0.001);
      }
    }

    expect(springSettleTime(SPRINGS.snappy)).toBeLessThan(springSettleTime(SPRINGS.bouncy));
  });

  it('overshoots when underdamped and never when overdamped', () => {
    const peak = (spring: SpringParams) =>
      Math.max(...Array.from({ length: 300 }, (_, i) => springPosition(spring, i / 100)));

    expect(peak(SPRINGS.bouncy)).toBeGreaterThan(1.1);
    expect(peak(SPRINGS.overdamped)).toBeLessThanOrEqual(1);
  });
});

describe('lowered curves stay within tolerance of the true curve', () => {
  const specs = [
    ...Object.keys(NAMED_CURVES),
    'ease',
    'ease-in',
    'cubic-bezier(0.34, 1.56, 0.64, 1)',
    'cubic-bezier(0.16, 1, 0.3, 1)',
    'cubic-bezier(0.68, -0.6, 0.32, 1.6)',
    'spring(420, 30)',
    'spring(300, 14)',
    'spring(180, 12)',
    'spring(100, 60)',
    'spring(250, 18, 1.5, 8)',
  ];

  for (const spec of specs) {
    it(spec, () => {
      // Hermite pieces are checked at 8 probes each; between probes allow a little slack.
      expect(maxError(spec)).toBeLessThan(TOLERANCE * 2);
    });
  }

  it('is exactly 0 before the window and 1 after it', () => {
    const expr = easedProgressExpr(parseEasing('spring(300, 14)'), WINDOW);

    expect(evaluateExpr(expr, { t: 0 })).toBe(0);
    expect(evaluateExpr(expr, { t: WINDOW.delay - 0.01 })).toBe(0);
    expect(evaluateExpr(expr, { t: WINDOW.delay + WINDOW.duration })).toBe(1);
    expect(evaluateExpr(expr, { t: 9 })).toBe(1);
  });

  it('bounds expression size: typical curves under 4k characters, the bounciest legal spring under 12k', () => {
    const expr = easedProgressExpr(parseEasing('spring(2000, 9)'), { delay: 0, duration: 2 });

    expect(expr.length).toBeLessThan(12000);
    expect(easedProgressExpr(parseEasing('spring(180, 12)'), WINDOW).length).toBeLessThan(4000);
    expect(easedProgressExpr(parseEasing('cubic-bezier(0.34, 1.56, 0.64, 1)'), WINDOW).length).toBeLessThan(2000);
  });

  it('lowers steps exactly', () => {
    const expr = easedProgressExpr(parseEasing('steps(4)'), { delay: 0, duration: 1 });

    expect(evaluateExpr(expr, { t: 0.3 })).toBe(0.25);
    expect(evaluateExpr(expr, { t: 0.99 })).toBe(0.75);
    expect(
      evaluateExpr(easedProgressExpr(parseEasing('steps(4, start)'), { delay: 0, duration: 1 }), { t: 0.01 })
    ).toBe(0.25);
  });

  it('follows custom points', () => {
    expect(
      maxError({
        points: [
          [0, 0],
          [0.4, 1.08],
          [1, 1],
        ],
      } as never)
    ).toBeLessThan(TOLERANCE * 2);
  });
});

describe('easing grammar', () => {
  it('reports what is wrong', () => {
    expect(easingError('ease-out-expo')).toBeNull();
    expect(easingError('ease-outt')).toMatch(/unknown easing/);
    expect(easingError('cubic-bezier(1.2, 0, 0, 1)')).toMatch(/x1\/x2/);
    expect(easingError('cubic-bezier(0, 0, 1)')).toMatch(/expects 4 numbers/);
    expect(easingError('spring(5000, 10)')).toMatch(/stiffness/);
    expect(easingError('spring(2000, 1)')).toMatch(/damping ratio/);
    expect(easingError('steps(0)')).toMatch(/count/);
    expect(easingError('$snappy')).toMatch(/unresolved motion token/);
    expect(
      easingError({
        points: [
          [0, 0],
          [0.5, 1],
        ],
      })
    ).toMatch(/end at p=1/);
  });

  it('derives a spring duration from its physics', () => {
    expect(parseEasing('spring(420, 30)').settle).toBeCloseTo(springSettleTime({ stiffness: 420, damping: 30 }), 6);
    expect(parseEasing('ease-out-expo').settle).toBeUndefined();
  });
});
