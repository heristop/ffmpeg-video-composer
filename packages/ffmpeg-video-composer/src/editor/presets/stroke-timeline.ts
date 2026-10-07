// The life of a stroke graphic sampled on the output frame grid: an entrance of `frames` frames, a hold,
// and an optional exit that ends at `until` (or the end of the section). Each sample says WHAT is drawn
// (spans of each path, at one or more alpha levels), how far the outline is inflated and its overall
// alpha. Consecutive identical samples merge into one window, so a hold is one window whatever its length.
//
// Timing conventions (shared with the sprite fades in stroke-lower.ts, so drawbox strokes and arc sprites
// agree to the frame): entrance frame f (at + f/fps) shows progress u = (f + 1) / frames; an alpha ramp
// shows f / frames, which is exactly `fade=t=in:st=at:d=frames/fps`. Exit frame m shows q = (m + 1) /
// frames for motion and 1 − m / frames for alpha (`fade=t=out:st=start:d=frames/fps`).

import { mergeRuns } from './graphics-spec';
import { subtract, type Span } from './stroke-path';

/** What one frame draws: spans per path at an alpha level. */
export interface StrokeLevel {
  spans: Span[][];
  alpha: number;
}

/** A pose of the graphic. `grow` inflates the outline (px per side); `alpha` multiplies everything. */
export interface StrokePose {
  levels: StrokeLevel[];
  grow: number;
  alpha: number;
}

export interface StrokeSample {
  from: number;
  to: number | undefined;
  pose: StrokePose;
}

export interface StrokePhase {
  start: number;
  frames: number;
}

export interface StrokePlan {
  fps: number;
  entrance: StrokePhase;
  /** Pose at linear entrance progress u ∈ (0, 1] (the type applies its own curve, stagger and spread). */
  enter: (u: number) => StrokePose;
  /** The settled pose, held between the entrance and the exit. */
  rest: StrokePose;
  /** The newest steps of a travelling head draw fainter (a short head fade). */
  headFade: boolean;
  exit: StrokePhase | null;
  /** Pose at exit progress: `q` linear motion progress, `fade` the alpha (1 → 0). */
  leave: ((q: number, fade: number) => StrokePose) | null;
  /** When nothing is drawn any more (the end of the exit, or `until`); undefined holds to the cut. */
  end: number | undefined;
}

/** Alpha of the newest, then the previous step of a travelling head. */
const HEAD = [0.35, 0.7];

function onGrid(seconds: number, fps: number): number {
  return Math.round(seconds * fps) / fps;
}

/** Entrance window on the frame grid: `frames` whole frames from `at`. */
export function entrancePhase(at: number, duration: number, fps: number): StrokePhase {
  return { start: onGrid(at, fps), frames: Math.max(1, Math.round(duration * fps)) };
}

/**
 * The exit window: `duration` before `end`, never before the entrance has finished. Null when there is no
 * room left for even one frame of exit.
 */
export function exitPhase(end: number | undefined, duration: number, after: number, fps: number): StrokePhase | null {
  if (end === undefined) return null;

  const stop = onGrid(end, fps);
  const start = Math.max(onGrid(after, fps), onGrid(stop - duration, fps));
  const frames = Math.round((stop - start) * fps);

  return frames >= 1 ? { start, frames } : null;
}

function minus(a: Span[][], b: Span[][]): Span[][] {
  return a.map((spans, i) => subtract(spans, b[i]));
}

// Spans drawn by the entrance frame `k` (none before the first frame).
function spansAt(plan: StrokePlan, k: number, paths: number): Span[][] {
  if (k < 0) return Array.from({ length: paths }, () => []);

  return plan.enter((k + 1) / plan.entrance.frames).levels[0].spans;
}

function headPose(plan: StrokePlan, f: number): StrokePose {
  const now = plan.enter((f + 1) / plan.entrance.frames);
  const paths = now.levels[0].spans.length;
  const [prev, older] = [spansAt(plan, f - 1, paths), spansAt(plan, f - 2, paths)];
  const levels: StrokeLevel[] = [
    { spans: older, alpha: 1 },
    { spans: minus(prev, older), alpha: HEAD[1] },
    { spans: minus(now.levels[0].spans, prev), alpha: HEAD[0] },
  ];

  return { ...now, levels };
}

function entranceSamples(plan: StrokePlan): StrokeSample[] {
  const { start, frames } = plan.entrance;

  return Array.from({ length: frames }, (_, f) => ({
    from: start + f / plan.fps,
    to: start + (f + 1) / plan.fps,
    pose: plan.headFade ? headPose(plan, f) : plan.enter((f + 1) / frames),
  }));
}

function exitSamples(plan: StrokePlan): StrokeSample[] {
  const exit = plan.exit;
  const leave = plan.leave;

  if (!exit || !leave) return [];

  return Array.from({ length: exit.frames }, (_, m) => ({
    from: exit.start + m / plan.fps,
    to: exit.start + (m + 1) / plan.fps,
    pose: leave((m + 1) / exit.frames, 1 - m / exit.frames),
  }));
}

/** Every window of the graphic's life, identical neighbours merged. */
export function strokeSamples(plan: StrokePlan): StrokeSample[] {
  const entrance = entranceSamples(plan);
  const holdFrom = plan.entrance.start + plan.entrance.frames / plan.fps;
  const holdTo = plan.exit?.start ?? plan.end;
  const hold = holdTo === undefined || holdTo > holdFrom ? [{ from: holdFrom, to: holdTo, pose: plan.rest }] : [];
  const all = [...entrance, ...hold, ...exitSamples(plan)];
  const end = plan.end;
  const bounded =
    end === undefined
      ? all
      : all.filter((sample) => sample.from < end).map((sample) => ({ ...sample, to: Math.min(sample.to ?? end, end) }));

  return mergeRuns(bounded, (sample) => JSON.stringify(sample.pose));
}

/** A pose drawing `spans` (one list per path) at full alpha. */
export function pose(spans: Span[][], grow = 0, alpha = 1): StrokePose {
  return { levels: [{ spans, alpha: 1 }], grow, alpha };
}
