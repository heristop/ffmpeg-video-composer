import { clamp01 } from '@/presentation/components/kinetic/gradient-meter.logic';
import {
  CHEER_SECONDS,
  CLICK_CLAP_SECONDS,
  cheerFrame,
  clapParts,
  clickClapFrame,
  runnerFrame,
  type ClappyPose,
} from '@/presentation/components/clappy/clappy.logic';
import { quipKey, type QUIP_KEYS } from '@/presentation/components/progress-display.logic';

// The landing's phone, chapter 03: the app's render screen, scrubbed by the scroll. Scrolling down through
// the chapter renders the video (the count, the bar, the app's own stage lines), scrolling back up rewinds it,
// and Clappy acts as the app's render screen has him: running in place, clapping at each quarter, cheering at
// 100%. Pure maths here, so the mapping is tested once; render-screen.tsx draws it.

export interface ScrollTrack {
  /** The anchor's top edge, in px from the top of the viewport. */
  top: number;
  /** The viewport's height in px. */
  viewport: number;
  /** Where the track starts, as a fraction of the viewport from its top: 0% when the anchor's top is there. */
  start: number;
  /** How far the anchor scrolls from the start line to 100%, in px. */
  distance: number;
}

/** How far the render has come, 0..1, for the anchor's place in the viewport. */
export const trackProgress = ({ top, viewport, start, distance }: ScrollTrack): number => {
  const travelled = start * viewport - top;

  if (distance <= 0) return travelled >= 0 ? 1 : 0;

  return clamp01(travelled / distance);
};

/** The share of the chapter's row the render takes; it holds "ready" over the rest, before the next chapter. */
const PINNED_SPAN = 0.8;

/**
 * The pinned phone (desktop): the anchor is the chapter's text. The chapter turns active as that text enters
 * the reading band from below (scroll-chapters.tsx: the band is the viewport's middle fifth, so 60% down),
 * and the next one takes over about a row later, so the render runs from the first to most of the second.
 */
export const pinnedTrack = (anchor: { top: number; row: number }, viewport: number): ScrollTrack => ({
  top: anchor.top,
  viewport,
  start: 0.6,
  distance: anchor.row * PINNED_SPAN,
});

/**
 * A phone in the chapter itself (narrow screens): the anchor is the phone. The render starts once a quarter
 * of it has risen into view and is done as its top reaches 15% down the viewport, the whole screen still on show.
 */
export const inlineTrack = (anchor: { top: number; height: number }, viewport: number): ScrollTrack => {
  const start = Math.min(1, (viewport - anchor.height * 0.25) / viewport);

  return { top: anchor.top, viewport, start, distance: (start - 0.15) * viewport };
};

export type RenderStage = 'preparing' | (typeof QUIP_KEYS)[number] | 'ready';

export interface RenderReadout {
  /** Whole percents, counted down: 100 only once the render is done. */
  percent: number;
  stage: RenderStage;
  /** The quarter reached, 0..3: the app cheers each one. */
  milestone: number;
  done: boolean;
}

/** What the render screen reads at a progress, 0..1: the app's count, its stage line, the quarter reached. */
export const renderReadout = (progress: number): RenderReadout => {
  const amount = clamp01(progress);
  const percent = Math.floor(amount * 100);
  const done = percent >= 100;
  const milestone = Math.min(3, Math.floor(amount * 4));

  if (done) return { percent, stage: 'ready', milestone, done };

  return { percent, stage: percent === 0 ? 'preparing' : quipKey(percent), milestone, done };
};

/** Whether scrolling from `previous` to `current` crossed a quarter forward; the finish has its own cheer. */
export const milestoneReached = (previous: number, current: number): boolean => {
  if (current <= previous) return false;

  const from = Math.floor(clamp01(previous) * 4);
  const to = Math.min(3, Math.floor(clamp01(current) * 4));

  return to > from;
};

export interface ScreenClappyFrame {
  pose: ClappyPose;
  /** How high the stride lifts him, 0..1. */
  bob: number;
  /** Forward lean, in degrees. */
  lean: number;
  /** A slam's squash onto his feet, 0..1. */
  impact: number;
}

/** The ready screen when motion has to keep still: arms up, grinning, as the runner arrives. */
export const READY_FRAME: ScreenClappyFrame = { ...runnerFrame(0, { done: true, still: true }), impact: 0 };

export interface ScreenClock {
  /** Seconds he has been running. */
  run: number;
  /** Seconds into a quarter's clap; null when none plays. */
  cheer: number | null;
  /** Seconds since the render reached 100%; null while it runs. */
  finish: number | null;
}

/**
 * Clappy on the render screen: the web loader's run, in place. A quarter reached lays the click's clap over
 * the run (wound up, slammed shut, arms thrown up, a grin) without breaking his stride; 100% stops him for the
 * finished render's cheer, which settles into a smile.
 */
export const screenClappyFrame = ({ run, cheer, finish }: ScreenClock): ScreenClappyFrame => {
  if (finish !== null) {
    const { pose, impact } = cheerFrame(finish);

    return { pose, bob: 0, lean: 0, impact };
  }

  const runner = runnerFrame(run, { done: false, still: false });

  if (cheer === null || cheer >= CLICK_CLAP_SECONDS) return { ...runner, impact: 0 };

  const parts = clapParts(runner.pose);
  const { angle, armL, armR, impact, grin } = clickClapFrame(cheer, parts, parts);

  return { ...runner, pose: { ...runner.pose, angle, armL, armR, mood: grin ? 'grin' : 'smile' }, impact };
};

/** Whether the finishing cheer is over, so nothing moves until the next scroll. */
export const settled = (finish: number | null): boolean => finish !== null && finish >= CHEER_SECONDS;
