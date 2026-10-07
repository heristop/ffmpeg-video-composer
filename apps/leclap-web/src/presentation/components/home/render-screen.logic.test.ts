import { describe, expect, it } from 'vitest';
import { CHEER_SECONDS, CLICK_CLAP_SECONDS, REST_ANGLE } from '@/presentation/components/clappy/clappy.logic';
import {
  READY_FRAME,
  milestoneReached,
  pinnedTrack,
  inlineTrack,
  renderReadout,
  screenClappyFrame,
  settled,
  trackProgress,
} from './render-screen.logic';

describe('trackProgress', () => {
  it('starts at 0 when the anchor reaches its start line and ends at 1 a distance later', () => {
    expect(trackProgress({ top: 600, viewport: 1000, start: 0.6, distance: 400 })).toBe(0);
    expect(trackProgress({ top: 400, viewport: 1000, start: 0.6, distance: 400 })).toBe(0.5);
    expect(trackProgress({ top: 200, viewport: 1000, start: 0.6, distance: 400 })).toBe(1);
  });

  it('clamps before the start and past the end', () => {
    expect(trackProgress({ top: 900, viewport: 1000, start: 0.6, distance: 400 })).toBe(0);
    expect(trackProgress({ top: -900, viewport: 1000, start: 0.6, distance: 400 })).toBe(1);
  });

  it('treats a collapsed distance as a step at the start line', () => {
    expect(trackProgress({ top: 601, viewport: 1000, start: 0.6, distance: 0 })).toBe(0);
    expect(trackProgress({ top: 600, viewport: 1000, start: 0.6, distance: 0 })).toBe(1);
  });
});

describe('pinnedTrack', () => {
  it('starts as the chapter text enters the reading band and finishes before the next chapter takes over', () => {
    const track = pinnedTrack({ top: 600, row: 760 }, 1000);

    expect(track.start).toBe(0.6);
    expect(track.distance).toBeLessThan(760);
    expect(trackProgress({ ...track, top: 600 - 760 })).toBe(1);
  });
});

describe('inlineTrack', () => {
  it('starts as the phone rises into view and finishes while the whole screen is still on show', () => {
    const viewport = 844;
    const track = inlineTrack({ top: 0, height: 452 }, viewport);

    expect(trackProgress({ ...track, top: viewport * 0.9 })).toBe(0);
    // Done by the time its top has climbed to a tenth of the screen, still entirely visible.
    expect(trackProgress({ ...track, top: viewport * 0.1 })).toBe(1);
  });
});

describe('renderReadout', () => {
  it('prepares the scenes at 0%', () => {
    expect(renderReadout(0)).toEqual({ percent: 0, stage: 'preparing', milestone: 0, done: false });
  });

  it('advances through the app quips as the bar climbs', () => {
    expect(renderReadout(0.13).stage).toBe('progress.quip.reels');
    expect(renderReadout(0.5).stage).toBe('progress.quip.magic');
    expect(renderReadout(0.99).stage).toBe('progress.quip.showtime');
  });

  it('counts whole percents down, so 100% only shows once the render is done', () => {
    expect(renderReadout(0.996)).toMatchObject({ percent: 99, done: false });
    expect(renderReadout(1)).toEqual({ percent: 100, stage: 'ready', milestone: 3, done: true });
  });

  it('reports the quarter reached, as the app cheers them', () => {
    expect(renderReadout(0.24).milestone).toBe(0);
    expect(renderReadout(0.25).milestone).toBe(1);
    expect(renderReadout(0.74).milestone).toBe(2);
    expect(renderReadout(0.8).milestone).toBe(3);
  });

  it('clamps out-of-range progress', () => {
    expect(renderReadout(-1).percent).toBe(0);
    expect(renderReadout(3).percent).toBe(100);
  });
});

describe('milestoneReached', () => {
  it('fires on a forward crossing of 25, 50 or 75%', () => {
    expect(milestoneReached(0.2, 0.26)).toBe(true);
    expect(milestoneReached(0.49, 0.5)).toBe(true);
    expect(milestoneReached(0.6, 0.9)).toBe(true);
  });

  it('stays quiet within a quarter, when rewinding, and at the finish (it has its own cheer)', () => {
    expect(milestoneReached(0.3, 0.4)).toBe(false);
    expect(milestoneReached(0.6, 0.4)).toBe(false);
    expect(milestoneReached(0.8, 1)).toBe(false);
  });
});

describe('screenClappyFrame', () => {
  it('runs in place: feet trading places, a bob and a lean, no travel', () => {
    const frame = screenClappyFrame({ run: 0.1, cheer: null, finish: null });

    expect(frame.pose.stride).toBeCloseTo(0.225);
    expect(frame.lean).toBeGreaterThan(0);
    expect(frame.pose.mood).toBe('smile');
  });

  it('claps and grins over the run at a milestone, still running', () => {
    const slam = screenClappyFrame({ run: 1, cheer: 0.3, finish: null });

    expect(slam.pose.stride).toBeDefined();
    expect(slam.pose.mood).toBe('grin');
    expect(slam.pose.angle).toBeCloseTo(0, 0);
    expect(slam.impact).toBeGreaterThan(0);
  });

  it('hands back to the plain run once the milestone clap is over', () => {
    const after = screenClappyFrame({ run: 1, cheer: CLICK_CLAP_SECONDS + 0.01, finish: null });

    expect(after).toEqual(screenClappyFrame({ run: 1, cheer: null, finish: null }));
  });

  it('stops running and plays the finishing clap at 100%, then settles', () => {
    const slam = screenClappyFrame({ run: 4, cheer: null, finish: 0.62 });

    expect(slam.pose.stride).toBeUndefined();
    expect(slam.pose.mood).toBe('grin');

    const rest = screenClappyFrame({ run: 4, cheer: null, finish: CHEER_SECONDS + 1 });

    expect(rest.pose.angle).toBeCloseTo(REST_ANGLE, 0);
    expect(rest.impact).toBe(0);
  });

  it('has a still, happy frame for the ready screen under reduced motion', () => {
    expect(READY_FRAME.pose.stride).toBeUndefined();
    expect(READY_FRAME.pose.mood).toBe('grin');
    expect(READY_FRAME.bob).toBe(0);
  });
});

describe('settled', () => {
  it('only once the finishing clap is over: the loop can rest until the next scroll', () => {
    expect(settled(null)).toBe(false);
    expect(settled(1)).toBe(false);
    expect(settled(CHEER_SECONDS)).toBe(true);
  });
});
