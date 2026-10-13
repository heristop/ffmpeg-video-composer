// A layer's opacity track (inputs[].options.animate.opacity) as alpha multiplies the on-device engine can
// run. `colorchannelmixer` takes a constant `aa`, never an expression in t, and the per-pixel filters that
// could (geq, blend) are not in the LGPL build. So the track is sampled once per output frame at compile
// time, quantised to steps of 1/50, and each level that is not opaque becomes one colorchannelmixer gated
// (timeline `enable`) to the frames that hold it — the same per-run stepping editor/utils/stepped-fontsize.ts
// uses for an animated drawtext size. Frames before the first key hold its value, frames after the last
// hold the last one, so the first and last windows are open-ended.

import { fmt } from '@/core/motion/hermite';
import { resolveKeyTimes, trackExpr, type TrackKey } from '@/core/motion/tracks';
import { evaluateExpr } from '../../services/geometry/drawtext-expr';

const LEVELS = 50;
const MAX_FRAMES = 18_000;

interface Run {
  level: number;
  first: number;
  last: number;
}

// The quantised opacity of every frame from 0 to the first frame at or after the last key.
function levelsPerFrame(keys: readonly TrackKey[], fps: number): number[] {
  const expr = `clip(${trackExpr(keys)},0,1)`;
  const end = resolveKeyTimes(keys).at(-1)?.at ?? 0;
  const frames = Math.min(Math.ceil(end * fps - 1e-6) + 1, MAX_FRAMES);

  return Array.from({ length: Math.max(1, frames) }, (_, n) => {
    const value = evaluateExpr(expr, { t: n / fps, n });

    if (value === null) throw new Error(`layer animate: the opacity track "${expr}" could not be sampled`);

    return Math.round(value * LEVELS) / LEVELS;
  });
}

function runsOf(levels: number[]): Run[] {
  const runs: Run[] = [];

  for (const [frame, level] of levels.entries()) {
    const current = runs.at(-1);

    if (current?.level === level) {
      current.last = frame;
      continue;
    }

    runs.push({ level, first: frame, last: frame });
  }

  return runs;
}

// A run's frames as an enable window, its edges half a frame away so a frame time never lands on one.
function windowOf(run: Run, lastFrame: number, fps: number): string {
  const bounds: string[] = [];

  if (run.first > 0) bounds.push(`gte(t,${fmt((run.first - 0.5) / fps)})`);

  if (run.last < lastFrame) bounds.push(`lt(t,${fmt((run.last + 0.5) / fps)})`);

  return bounds.join('*');
}

/** The colorchannelmixer alpha steps of an opacity track; none for an opaque layer. */
export function opacitySteps(keys: readonly TrackKey[], fps: number): string[] {
  const levels = levelsPerFrame(keys, fps);
  const windows = new Map<number, string[]>();

  for (const run of runsOf(levels)) {
    if (run.level >= 1) continue;

    windows.set(run.level, [...(windows.get(run.level) ?? []), windowOf(run, levels.length - 1, fps)]);
  }

  return [...windows].map(([level, spans]) => {
    const gate = spans.every((span) => span !== '') ? `:enable='${spans.join('+')}'` : '';

    return `colorchannelmixer=aa=${fmt(level)}${gate}`;
  });
}
