import { describe, expect, it } from 'vitest';
import { buildAnimationLegFilters, buildLoopFlags, imageOverlayEnable } from '@/editor/utils/input-sources';
import { layerKeyframes } from '@/editor/presets/layer-keyframes';
import { trackExpr } from '@/core/motion/tracks';

// Library callers that skip validation can hand the lowering any JSON value where the schema wants a
// number or a relative "+80": each must stay a number before it is written into a filter.

const HOSTILE = '1,metadata=print:a:b:same_str:1:pwned.txt';

describe('overlay leg numbers', () => {
  it('refuses a rotation that is not a number', () => {
    expect(() => buildAnimationLegFilters({ rotation: HOSTILE as never })).toThrow(/rotation/);
  });

  it('refuses an opacity that is not a number', () => {
    expect(() => buildAnimationLegFilters({ opacity: HOSTILE as never })).toThrow(/opacity/);
  });

  it('keeps numeric rotation and opacity', () => {
    expect(buildAnimationLegFilters({ rotation: 90, opacity: 0.5 }).join(',')).toContain('colorchannelmixer=aa=0.5');
  });
});

describe('still-image overlay timeline', () => {
  it.each([{ start: HOSTILE }, { start: 1, duration: HOSTILE }])('refuses %o', (options) => {
    expect(() => imageOverlayEnable(options as never)).toThrow(/start|duration/);
  });

  it('keeps numbers', () => {
    expect(imageOverlayEnable({ start: 1, duration: 2 })).toBe(":enable='between(t,1,3)'");
  });
});

describe('layer keyframe values', () => {
  it('refuses a relative value that is not "+n" / "-n"', () => {
    expect(() => trackExpr([{ v: `+80${HOSTILE}` }, { t: 1, v: '+0' }] as never, 0)).toThrow(/keyframe/);
  });

  it('refuses a value that is not a finite number', () => {
    expect(() => trackExpr([{ v: Number.NaN }, { t: 1, v: 1 }] as never, 0)).toThrow(/keyframe/);
  });

  it('keeps relative and absolute values', () => {
    expect(trackExpr([{ v: '+80' }, { t: 1, v: 10 }] as never, 'W/2')).toContain('(W/2)+80');
  });
});

describe('skipValidation callers', () => {
  it.each([{ start: HOSTILE }, { duration: HOSTILE }, { loops: HOSTILE }])('refuses loop flags %o', (options) => {
    expect(() => buildLoopFlags(options as never)).toThrow(/start|duration|loops/);
  });

  it('keeps numeric loop flags', () => {
    expect(buildLoopFlags({ duration: 3, start: 1 })).toBe('-stream_loop -1 -itsoffset 1 -t 3 ');
  });

  it('refuses a keyframe rotation that is not a number', () => {
    expect(() =>
      layerKeyframes({ rotation: HOSTILE, animate: { rotate: [{ v: 0 }, { t: 1, v: 5 }] } } as never, 30)
    ).toThrow(/rotation/);
  });
});
