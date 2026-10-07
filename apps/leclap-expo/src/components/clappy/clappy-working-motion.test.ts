import {
  BLINKS,
  CHEER_MS,
  CLAPPER_SHUT,
  DUST_PUFFS,
  GLANCES,
  LOOP_MS,
  RESTING_POSE,
  RUN_CADENCE,
  blendPose,
  cheerPose,
  dustPuff,
  feet,
  footStep,
  runPose,
  type ClappyPose,
} from './clappy-working-motion';

const FRAME = 1000 / 60;
const STRIDE_MS = 1000 / RUN_CADENCE;
const keys = Object.keys(RESTING_POSE) as (keyof ClappyPose)[];
const times = (span: number, step = FRAME, from = 0) =>
  Array.from({ length: Math.floor(span / step) + 1 }, (_, i) => from + Math.min(i * step, span));
const run = times(20_000).map((ms) => runPose(ms));
const blinking = (ms: number) => BLINKS.some(({ at, double }) => ms >= at - 1 && ms <= at + (double ? 480 : 220));
const glancing = (ms: number) => GLANCES.some(({ at, hold }) => ms >= at - 1 && ms <= at + hold + 520);

describe('the gait, ported from the web runner', () => {
  it('lifts one foot in an arc through the first half-turn and plants it through the second', () => {
    expect(footStep(0)).toEqual({ dx: -16, dy: 0 });
    expect(footStep(0.25).dy).toBeCloseTo(-16, 6);
    expect(footStep(0.25).dx).toBeCloseTo(0, 6);
    expect(footStep(0.5).dx).toBeCloseTo(16, 6);
    expect(footStep(0.75).dy).toBe(0);
  });
  it('trades the feet half a turn apart, so one is always on the ground', () => {
    for (const phase of times(1, 0.01)) {
      const [left, right] = feet(phase);
      expect(Math.min(left.dy, right.dy)).toBeLessThanOrEqual(0);
      expect(Math.max(left.dy, right.dy)).toBeCloseTo(0, 6);
    }
  });
  it('trots at the web cadence, in place: no net travel over a stride', () => {
    expect(RUN_CADENCE).toBe(2.25);
    const stride = times(STRIDE_MS, STRIDE_MS / 64)
      .slice(0, -1)
      .map((ms) => runPose(ms));
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean(stride.map((p) => p.leftFootX))).toBeCloseTo(0, 6);
    expect(mean(stride.map((p) => p.rightFootX))).toBeCloseTo(0, 6);
    expect(Math.min(...stride.map((p) => p.leftFootY))).toBeCloseTo(-16, 1);
  });
  it('bobs twice per stride, squashing a little at the top, and leans into the run', () => {
    const second = times(1000, 1).map((ms) => runPose(ms).bob);
    const landings = second.filter(
      (bob, i) => i > 0 && i < second.length - 1 && bob > second[i - 1] && bob >= second[i + 1]
    );
    expect(landings.length).toBeGreaterThanOrEqual(4);
    expect(landings.length).toBeLessThanOrEqual(5);
    for (const pose of run) {
      expect(pose.bob).toBeLessThanOrEqual(0);
      expect(pose.bob).toBeGreaterThanOrEqual(-50);
      expect(pose.bodyScaleX).toBeCloseTo(1 - (0.03 * pose.bob) / 50, 6);
      expect(pose.bodyScaleY).toBeCloseTo(1 + (0.03 * pose.bob) / 50, 6);
      expect(pose.lean).toBe(8);
    }
  });
  it('pumps the arms against each other and clacks the clapper on each step without shutting it', () => {
    for (const pose of run) {
      expect(pose.armLeft + pose.armRight).toBeCloseTo(-12, 6);
      expect(Math.abs(pose.armLeft + 6)).toBeLessThanOrEqual(30);
      expect(pose.clapper).toBeGreaterThanOrEqual(-3);
      expect(pose.clapper).toBeLessThanOrEqual(9);
      expect(pose.clapper).toBeLessThan(CLAPPER_SHUT);
    }
  });
  it('wraps its long clock without a seam', () => {
    for (const key of keys) expect(runPose(LOOP_MS)[key]).toBeCloseTo(runPose(0)[key], 6);
    expect(runPose(LOOP_MS + 4321)).toEqual(runPose(4321));
  });
});

describe('a happy face', () => {
  it('runs smiling with wide-open eyes, blinking irregularly, sometimes twice', () => {
    const gaps = BLINKS.slice(1).map(({ at }, i) => at - BLINKS[i].at);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(2400);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(7000);
    expect(new Set(gaps.map((gap) => Math.round(gap / 100))).size).toBeGreaterThan(gaps.length * 0.6);
    expect(BLINKS.some(({ double }) => double)).toBe(true);
    expect(BLINKS.filter(({ double }) => double).length).toBeLessThan(BLINKS.length / 2);
    for (const [i, pose] of run.entries()) {
      expect(pose.happy).toBe(0);
      if (!blinking(i * FRAME)) expect(pose.blink).toBe(1);
    }
    expect(Math.min(...times(300, 4, BLINKS[0].at).map((ms) => runPose(ms).blink))).toBeLessThan(0.2);
  });
  it('keeps his eyes on the track ahead and now and then glances down at the progress', () => {
    expect(GLANCES.filter(({ y }) => y > 0.4).length).toBeGreaterThan(GLANCES.length / 2);
    for (const [i, pose] of run.entries()) {
      if (!glancing(i * FRAME)) expect(pose).toMatchObject({ lookX: 6, lookY: 0 });
      expect(Math.abs(pose.lookX)).toBeLessThanOrEqual(10);
      expect(Math.abs(pose.lookY)).toBeLessThanOrEqual(11);
    }
    const { at, hold, x, y } = GLANCES[0];
    expect(runPose(at + 300 + hold / 2)).toMatchObject({ lookX: x * 10, lookY: y * 11 });
  });
});

describe('the milestone cheer', () => {
  it('leaves the run untouched before and after', () => {
    for (const ms of [0, 1234, 9876]) {
      expect(cheerPose(runPose(ms), 0)).toEqual(runPose(ms));
      expect(cheerPose(runPose(ms), 1)).toEqual(runPose(ms));
    }
  });
  it('snaps the clapper shut mid-stride, throws the arms up and grins, never squinting', () => {
    const cheer = times(CHEER_MS, 4).map((ms) => cheerPose(runPose(5000 + ms), ms / CHEER_MS));
    const shut = cheer.findIndex((p) => p.clapper >= CLAPPER_SHUT - 0.01);
    expect(shut).toBeGreaterThan(0);
    expect(Math.min(...cheer.slice(0, shut).map((p) => p.clapper))).toBeLessThan(-8);
    expect(Math.max(...cheer.map((p) => p.clapper))).toBeLessThanOrEqual(CLAPPER_SHUT + 1e-9);
    expect(Math.max(...cheer.slice(shut, shut + 60).map((p) => p.happy))).toBe(1);
    expect(Math.max(...cheer.map((p) => (p.armLeft + p.armRight) / 2))).toBeGreaterThan(20);
    for (const pose of cheer) {
      expect(pose.happy).toBeGreaterThanOrEqual(0);
      expect(pose.happy).toBeLessThanOrEqual(1);
    }
  });
});

describe('settling', () => {
  it('blends any pose toward standing still, so he slows to a stop instead of freezing mid-stride', () => {
    const mid = cheerPose(runPose(7300), 0.45);
    expect(blendPose(mid, 0)).toEqual(RESTING_POSE);
    expect(blendPose(mid, 1)).toEqual(mid);
    expect(blendPose(mid, 0.5).lean).toBeCloseTo(mid.lean / 2, 6);
    expect(blendPose(mid, 0.5).leftFootY).toBeCloseTo(mid.leftFootY / 2, 6);
  });
});

describe('the dust, ported from the web runner', () => {
  it('kicks up three puffs a third of a stride apart, sized for a 120 px runner', () => {
    expect(DUST_PUFFS).toBe(3);
    expect(dustPuff(0, 0)).toEqual({ x: 18, y: 8, size: 10, opacity: 0.6 });
    const second = dustPuff(0, 1);
    expect(second.x).toBeCloseTo(18 - 46 / 3, 6);
    expect(second.y).toBeCloseTo(8 + 14 / 3, 6);
    expect(second.size).toBeCloseTo(10 + 16 / 3, 6);
    expect(second.opacity).toBeCloseTo(0.4, 6);
    expect(dustPuff(4.5, 2).opacity).toBeCloseTo((1 - ((4.5 + 2 / 3) % 1)) * 0.6, 6);
  });
  it('drifts each puff back and up, growing and fading out over one stride', () => {
    const life = times(0.99, 0.01).map((stride) => dustPuff(stride, 0));
    for (let i = 1; i < life.length; i++) {
      expect(life[i].x).toBeLessThan(life[i - 1].x);
      expect(life[i].y).toBeGreaterThan(life[i - 1].y);
      expect(life[i].size).toBeGreaterThan(life[i - 1].size);
      expect(life[i].opacity).toBeLessThan(life[i - 1].opacity);
    }
    expect(life.at(-1)?.opacity).toBeLessThan(0.01);
  });
  it('stops kicking up dust once he stops, but lets the live puffs fade out', () => {
    const stoppedAt = 10.2;
    expect([0, 1, 2].map((i) => dustPuff(10.3, i, stoppedAt).opacity > 0)).toEqual([true, true, true]);
    expect([0, 1, 2].map((i) => dustPuff(10.5, i, stoppedAt).opacity > 0)).toEqual([true, true, false]);
    expect([0, 1, 2].map((i) => dustPuff(11.25, i, stoppedAt).opacity)).toEqual([0, 0, 0]);
  });
  it('raises no dust before he has run', () => {
    expect([0, 1, 2].map((i) => dustPuff(0.4, i, -Infinity).opacity)).toEqual([0, 0, 0]);
  });
});

// The pose runs as worklets on device. Worklets can't call Babel's helpers (array destructuring, for…of,
// spread) nor, there, Array.prototype.at: each crashed Clappy on render. Jest's Node runtime has them all,
// so guard the source instead.
it('keeps helper-dependent syntax out of the worklet module', () => {
  // Jest runs from the app root.
  const source = require('node:fs').readFileSync('src/components/clappy/clappy-working-motion.ts', 'utf8');

  expect(source).not.toMatch(/\.at\(/);
  expect(source).not.toMatch(/for \(const /);
  expect(source).not.toMatch(/const \[/);
  expect(source).not.toMatch(/\.\.\.[a-z]/);
});

// The worklets plugin compiles each worklet declaration to `var name = factory(closure)` in file order, so a
// worklet that calls one declared further down captures undefined and Clappy crashes on render.
it('declares every worklet before the worklets that call it', () => {
  const source: string = require('node:fs').readFileSync('src/components/clappy/clappy-working-motion.ts', 'utf8');
  const declared = [...source.matchAll(/function (\w+)\([^)]*\)[^{]*\{\n {2}'worklet';/g)];
  const late = declared.flatMap((match, index) => {
    const body = source.slice(match.index, declared[index + 1]?.index ?? source.length);

    return declared
      .slice(index + 1)
      .filter((later) => new RegExp(`\\b${later[1]}\\(`).test(body.slice(body.indexOf('{'))))
      .map((later) => `${match[1]} -> ${later[1]}`);
  });

  expect(late).toEqual([]);
});
