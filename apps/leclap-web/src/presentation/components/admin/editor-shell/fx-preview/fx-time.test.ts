// Time sampling of the live preview: the kit's pass progress, ramps and envelopes at one section time, and
// the span the canvas loops over when no playhead runs.
import { describe, expect, it } from 'vitest';
import type { AnyFxContext } from 'ffmpeg-video-composer/src/editor/presets/fx-kit.ts';
import {
  ambientEnvelope,
  lightEnvelope,
  loopSpan,
  loopTime,
  passProgress,
  passStart,
  pulseEnvelope,
  rampIn,
  rampOut,
} from './fx-time';

function window(fields: Partial<AnyFxContext>): AnyFxContext {
  return {
    at: 1,
    duration: 1,
    passes: 1,
    every: 2,
    end: 2,
    ease: 'linear',
    frame: { width: 1280, height: 720, fps: 30 },
    ...fields,
  } as AnyFxContext;
}

describe('pass progress', () => {
  it('is null outside the window, eased inside, held at 1 after the pass', () => {
    const fx = window({ end: 3 });

    expect(passProgress(fx, 0.5)).toBeNull();
    expect(passProgress(fx, 1.5)).toBeCloseTo(0.5);
    expect(passProgress(fx, 2.5)).toBe(1);
    expect(passProgress(fx, 3.5)).toBeNull();
  });

  it('restarts every pass `every` seconds', () => {
    const fx = window({ passes: 3, every: 2, end: 6 });

    expect(passStart(fx, 3.25)).toBe(3);
    expect(passProgress(fx, 3.25)).toBeCloseTo(0.25);
    expect(passStart(fx, 5.9)).toBe(5);
  });

  it('follows the effect curve', () => {
    expect(passProgress(window({ ease: 'cubic-bezier(0.16, 1, 0.3, 1)' }), 1.3)).toBeGreaterThan(0.5);
  });
});

describe('ramps and envelopes', () => {
  it('ramps linearly in and out', () => {
    expect(rampIn(1.5, 1, 1)).toBe(0.5);
    expect(rampOut(1.5, 1, 1)).toBe(0.5);
    expect(rampIn(0, 1, 0)).toBe(0);
    expect(rampOut(2, 1, 0)).toBe(0);
  });

  it('opens and closes the light envelope over the window', () => {
    const fx = window({ at: 0, end: 4 });

    expect(lightEnvelope(fx, 0, 0.3, 0.5)).toBe(0);
    expect(lightEnvelope(fx, 1.5, 0.3, 0.5)).toBe(1);
    expect(lightEnvelope(fx, 4, 0.3, 0.5)).toBe(0);
  });

  it('holds an ambient texture between its ramps, and pulses a reduced stand-in at mid-window', () => {
    const fx = window({ at: 0, end: 6 });

    expect(ambientEnvelope(fx, 3, 0.5)).toBe(1);
    expect(ambientEnvelope(fx, 0.25, 0.5)).toBeCloseTo(0.5);
    expect(pulseEnvelope(fx, 3)).toBe(1);
    expect(pulseEnvelope(fx, 1.5)).toBeCloseTo(0.5);
  });
});

describe('the canvas loop', () => {
  it('replays the window with a lead-in and a tail, within the section', () => {
    expect(loopSpan(1, 2, 12)).toEqual([0.65, 2.5]);
    expect(loopSpan(0, 0.5, 12)).toEqual([0, 1]);
    // A long ambient effect loops its first seconds; a short section bounds the loop.
    expect(loopSpan(0, 20, 30)).toEqual([0, 8]);
    expect(loopSpan(0, 6, 4)).toEqual([0, 4]);
  });

  it('wraps the elapsed time into the span', () => {
    expect(loopTime([1, 3], 0.5)).toBe(1.5);
    expect(loopTime([1, 3], 2.5)).toBe(1.5);
  });
});
