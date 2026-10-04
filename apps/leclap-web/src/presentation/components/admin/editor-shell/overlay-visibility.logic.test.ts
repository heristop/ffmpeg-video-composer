import { describe, it, expect } from 'vitest';
import { overlayVisibilityAt, revealOffset, easeOutExpo, REVEAL_DEFAULTS } from './overlay-visibility.logic';

describe('easeOutExpo', () => {
  it('pins the endpoints and rises steeply early', () => {
    expect(easeOutExpo(0)).toBe(0);
    expect(easeOutExpo(1)).toBe(1);
    expect(easeOutExpo(0.5)).toBeGreaterThan(0.9);
  });
});

describe('revealOffset', () => {
  it('rises toward rest on entrance and away on exit', () => {
    const enter = revealOffset('rise', 0, 60, true);
    expect(enter.translateY).toBe(60);
    expect(enter.opacity).toBe(0);

    const settled = revealOffset('rise', 1, 60, true);
    expect(settled.translateY).toBe(0);
    expect(settled.opacity).toBe(1);

    const leaving = revealOffset('rise', 1, 60, false);
    expect(leaving.translateY).toBe(-60);
    expect(leaving.opacity).toBe(0);
  });

  it('slides horizontally for slide styles and fades in place for fade', () => {
    expect(revealOffset('slide-left', 0, 60, true).translateX).toBe(60);
    expect(revealOffset('slide-right', 0, 60, true).translateX).toBe(-60);
    const fade = revealOffset('fade', 0.0, 60, true);
    expect(fade.translateX).toBe(0);
    expect(fade.translateY).toBe(0);
  });

  it('treats unknown/none styles as always visible', () => {
    expect(revealOffset('none', 0, 60, true)).toEqual({ opacity: 1, translateX: 0, translateY: 0 });
  });
});

describe('overlayVisibilityAt', () => {
  it('is resting for an overlay without reveal or exit', () => {
    expect(overlayVisibilityAt(undefined, undefined, 2, 8)).toMatchObject({ phase: 'hold', opacity: 1 });
  });

  it('walks before → reveal → hold with default timing', () => {
    const reveal = 'rise' as const;
    expect(overlayVisibilityAt(reveal, undefined, 0.1, 8).phase).toBe('before');
    expect(overlayVisibilityAt(reveal, undefined, 0.1, 8).opacity).toBe(0);

    const mid = overlayVisibilityAt(reveal, undefined, REVEAL_DEFAULTS.delay + 0.3, 8);
    expect(mid.phase).toBe('reveal');
    expect(mid.progress).toBeCloseTo(0.5, 5);

    expect(overlayVisibilityAt(reveal, undefined, 2, 8)).toMatchObject({ phase: 'hold', opacity: 1 });
  });

  it('honours object timing overrides', () => {
    const custom = { type: 'fade', delay: 1, duration: 2 } as const;
    expect(overlayVisibilityAt(custom, undefined, 0.9, 8).phase).toBe('before');
    expect(overlayVisibilityAt(custom, undefined, 2, 8)).toMatchObject({ phase: 'reveal' });
    expect(overlayVisibilityAt(custom, undefined, 2, 8).progress).toBeCloseTo(0.5, 5);
  });

  it('times an after-less exit to end exactly at the scene end', () => {
    const exit = 'fade' as const;
    // duration 8, exit duration 0.6 → exit starts at 7.4
    expect(overlayVisibilityAt(undefined, exit, 7.3, 8).phase).toBe('hold');
    expect(overlayVisibilityAt(undefined, exit, 7.7, 8).phase).toBe('exit');
    expect(overlayVisibilityAt(undefined, exit, 7.7, 8).progress).toBeCloseTo(0.5, 5);
  });

  it('starts an explicit exit at `after` seconds and hides beyond it', () => {
    const exit = { type: 'rise', after: 3, duration: 1 } as const;
    expect(overlayVisibilityAt(undefined, exit, 2.9, 8).phase).toBe('hold');
    expect(overlayVisibilityAt(undefined, exit, 3.5, 8).phase).toBe('exit');
    expect(overlayVisibilityAt(undefined, exit, 5, 8)).toMatchObject({ phase: 'after', opacity: 0 });
  });

  it('ignores none-type reveals and exits', () => {
    expect(overlayVisibilityAt('none', 'none', 0, 8)).toMatchObject({ phase: 'hold', opacity: 1 });
  });
});

// The authored `easing` mirrors the engine's expression curves (linear ramp, cubic-out, smoothstep);
// an UNSET easing keeps the monitor's signature ease-out-expo feel, unchanged for old templates.
describe('reveal easing mirror', () => {
  it('samples authored exit easing and native departure directions', () => {
    const exit = { type: 'rise', after: 2, duration: 1, distance: 80, easing: 'ease-out' } as const;
    expect(overlayVisibilityAt(undefined, exit, 2.5, 4)).toMatchObject({
      opacity: 0.125,
      translateY: -70,
    });
    expect(revealOffset('slide-left', 0.5, 80, false, 'linear').translateX).toBe(-40);
    expect(revealOffset('slide-right', 0.5, 80, false, 'linear').translateX).toBe(40);
    expect(overlayVisibilityAt(undefined, { ...exit, easing: 'ease-in-out' }, 2.25, 4).opacity).toBe(0.84375);
  });

  it('linear easing samples the raw progress', () => {
    const mid = revealOffset('rise', 0.5, 60, true, 'linear');
    expect(mid.opacity).toBeCloseTo(0.5, 5);
    expect(mid.translateY).toBeCloseTo(30, 5);
  });

  it('ease-out samples the cubic-out curve the engine lowers (1-(1-p)^3)', () => {
    expect(revealOffset('fade', 0.5, 60, true, 'ease-out').opacity).toBeCloseTo(0.875, 5);
  });

  it('overshoots native motion without letting entrance or exit opacity exceed its bounds', () => {
    const enter = revealOffset('rise', 0.5, 80, true, 'ease-out-back');
    expect(enter.translateY).toBeCloseTo(-7.0158, 4);
    expect(enter.opacity).toBe(1);
    const exit = revealOffset('rise', 0.5, 80, false, 'ease-out-back');
    expect(exit.opacity).toBe(0);
    expect(revealOffset('rise', 1, 80, true, 'ease-out-back').translateY).toBe(0);
  });

  it('ease-in-out samples the smoothstep curve (p*p*(3-2p))', () => {
    expect(revealOffset('fade', 0.5, 60, true, 'ease-in-out').opacity).toBeCloseTo(0.5, 5);
    expect(revealOffset('fade', 0.25, 60, true, 'ease-in-out').opacity).toBeCloseTo(0.15625, 5);
  });

  it('unset easing keeps the signature ease-out-expo feel', () => {
    expect(revealOffset('fade', 0.5, 60, true).opacity).toBeCloseTo(easeOutExpo(0.5), 5);
  });

  it('overlayVisibilityAt reads the easing off the reveal object', () => {
    const reveal = { type: 'rise', easing: 'linear' } as const;
    const mid = overlayVisibilityAt(reveal, undefined, REVEAL_DEFAULTS.delay + 0.3, 8);
    expect(mid.opacity).toBeCloseTo(0.5, 5);
    expect(mid.translateY).toBeCloseTo(30, 5);
  });
});
