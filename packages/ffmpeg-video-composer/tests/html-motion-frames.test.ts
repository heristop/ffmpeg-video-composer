import { describe, expect, it } from 'vitest';
import { finalStates, motionBudget, planMotionFrames, type ElementMotionMap } from '@/core/html/motion-frames';
import { REST_STATE } from '@/core/html/element-motion';

const fade = {
  opacity: [
    { t: 1, v: 0 },
    { t: 1.5, v: 1 },
  ],
};

function plan(names: string[], motion: ElementMotionMap, fps = 10) {
  const result = planMotionFrames(names, motion, fps);

  if (result.kind !== 'plan') throw new Error(`expected a plan, got ${result.kind}`);

  return result.plan;
}

describe('planMotionFrames', () => {
  it('draws only the animated span: the first state held from the section start, then one frame per tick', () => {
    const p = plan(['title'], { title: fade });

    expect(p.frames.map((frame) => frame.ticks)).toEqual([11, 1, 1, 1, 1, 1]);
    expect(p.frames.map((frame) => frame.states[0].opacity)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect([p.start, p.end]).toEqual([1, 1.5]);
  });

  it('staggers repeated names in document order', () => {
    const p = plan(['item', 'item', 'item'], { item: { ...fade, stagger: 0.2 } });

    expect(p.frames).toHaveLength(10);
    expect(p.end).toBeCloseTo(1.9, 10);
    expect(p.frames[0].states.map((state) => state.opacity)).toEqual([0, 0, 0]);
    expect(p.frames[5].states.map((state) => state.opacity)).toEqual([1, 0.6, 0.2]);
    expect(p.frames[9].states.map((state) => state.opacity)).toEqual([1, 1, 1]);
  });

  it('merges ticks where nothing moves into one held frame', () => {
    const hold = {
      opacity: [
        { t: 0, v: 0 },
        { t: 0.2, v: 1 },
        { t: 1, v: 1 },
        { t: 1.2, v: 0 },
      ],
    };
    const p = plan(['badge'], { badge: hold });

    expect(p.frames.map((frame) => [frame.states[0].opacity, frame.ticks])).toEqual([
      [0, 1],
      [0.5, 1],
      [1, 9],
      [0.5, 1],
      [0, 1],
    ]);
  });

  it('keeps untagged elements and unknown names at rest', () => {
    const p = plan(['title', 'body'], { title: fade, ghost: fade });

    expect(p.frames.map((frame) => frame.states[1])).toEqual(Array(6).fill(REST_STATE));
  });

  it('has nothing to draw when no tagged element has a track', () => {
    expect(planMotionFrames(['body'], { title: fade }, 30)).toEqual({ kind: 'none' });
    expect(planMotionFrames([], {}, 30)).toEqual({ kind: 'none' });
    expect(planMotionFrames(['constructor'], {}, 30)).toEqual({ kind: 'none' });
  });

  it('refuses a span over the limit without walking it', () => {
    const long = {
      x: [
        { t: 0, v: 0 },
        { t: 1000, v: 10 },
      ],
    };

    expect(planMotionFrames(['a'], { a: long }, 120)).toEqual({ kind: 'too-long', span: 1000 });
  });

  it('rounds states so the same template plans the same frames', () => {
    const pop = {
      scale: [
        { t: 0, v: 0.6 },
        { v: 1, ease: 'spring(300, 14)' },
      ],
    };
    const a = plan(['pop'], { pop }, 30);
    const scales = a.frames.map((frame) => frame.states[0].scale);

    expect(JSON.stringify(a)).toBe(JSON.stringify(plan(['pop'], { pop }, 30)));
    expect(scales.every((scale) => /^\d+(\.\d{1,4})?$/.test(String(scale)))).toBe(true);
    expect(Math.max(...scales)).toBeGreaterThan(1);
  });
});

describe('finalStates', () => {
  it('is every tagged element where its tracks end, untagged ones at rest', () => {
    const motion = {
      title: {
        x: [
          { t: 0, v: -40 },
          { t: 0.5, v: 20 },
        ],
      },
    };

    expect(finalStates(['title', 'body'], motion)).toEqual([{ ...REST_STATE, x: 20 }, REST_STATE]);
  });
});

describe('motionBudget', () => {
  it('passes a small card and names the first limit a large one breaks', () => {
    expect(motionBudget(plan(['title'], { title: fade }), 640, 240).problem).toBeNull();

    const many = plan(
      ['a'],
      {
        a: {
          x: [
            { t: 0, v: 0 },
            { t: 7.9, v: 790 },
          ],
        },
      },
      60
    );

    expect(many.frames).toHaveLength(475);
    expect(motionBudget(many, 200, 100).problem).toBe('475 distinct frames (limit 240)');

    const big = plan(
      ['a'],
      {
        a: {
          x: [
            { t: 0, v: 0 },
            { t: 2, v: 200 },
          ],
        },
      },
      30
    );

    expect(motionBudget(big, 1920, 1080).problem).toBe('506 megapixels of frames (limit 500)');
  });
});

describe('state clamping', () => {
  it('keeps opacity in 0..1 and scale in 0..10, and non-finite values at rest', () => {
    const wild = {
      opacity: [
        { t: 0, v: -2 },
        { t: 1, v: 3 },
      ],
      scale: [
        { t: 0, v: -1 },
        { t: 1, v: 40 },
      ],
    };
    const [state] = finalStates(['a'], { a: wild });

    expect(state.opacity).toBe(1);
    expect(state.scale).toBe(10);

    const p = plan(['a'], { a: wild });

    expect(p.frames[0].states[0]).toMatchObject({ opacity: 0, scale: 0 });

    const broken = {
      x: [
        { t: 0, v: Number.NaN },
        { t: 1, v: Number.POSITIVE_INFINITY },
      ],
    };

    expect(finalStates(['a'], { a: broken })[0]).toEqual(REST_STATE);
  });
});

describe('planMotionFrames bounds', () => {
  const late = {
    x: [
      { t: 1, v: 0 },
      { t: 2, v: 10 },
    ],
  };

  it('plans nothing for an fps that is not a positive finite number', () => {
    for (const fps of [0, -30, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(planMotionFrames(['a'], { a: late }, fps)).toEqual({ kind: 'none' });
    }
  });

  it('refuses an fps that would walk an unbounded number of ticks', () => {
    expect(planMotionFrames(['a'], { a: late }, 1e9)).toEqual({ kind: 'too-long', span: 1 });
  });

  it('never gives the first frame fewer than one tick when a time is negative', () => {
    const early = {
      x: [
        { t: -0.5, v: 0 },
        { t: 0.5, v: 10 },
      ],
    };
    const p = plan(['a'], { a: early });

    expect(p.frames.every((frame) => frame.ticks >= 1)).toBe(true);
    expect(p.frames[0].ticks).toBe(1);
  });
});
