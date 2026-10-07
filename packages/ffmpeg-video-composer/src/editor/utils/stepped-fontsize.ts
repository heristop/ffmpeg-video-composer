import type { Filter } from '@/core/types';
import { evaluateExpr } from '../../services/geometry/drawtext-expr';

// FFmpeg 8 drawtext crashes (SIGSEGV) as soon as an expression `fontsize` takes a different value on
// a later frame: the scaled kinetic units, the karaoke word pop and `animate.scale` tracks all did
// exactly that. drawtext rounds the evaluated size to whole pixels on every frame anyway, so the same
// picture is drawn by one drawtext per run of frames that share a size, each with a constant
// `fontsize` and gated to its frames. Identical output on every FFmpeg version, no crash on 8.

export interface FontSizeTiming {
  fps: number;
  // Seconds to sample: the section length (the last run is left open-ended, so it also covers any tail).
  duration: number;
}

interface SizeRun {
  size: number;
  first: number;
  last: number;
}

const MAX_SAMPLED_FRAMES = 18_000;

function unquote(expr: string): string {
  return expr.trim().replace(/^'(.*)'$/s, '$1');
}

// The rounded size on each frame, or null when the expression can't be evaluated here (left untouched).
function sizesPerFrame(expr: string, timing: FontSizeTiming): number[] | null {
  const frames = Math.min(Math.max(1, Math.ceil(timing.duration * timing.fps)), MAX_SAMPLED_FRAMES);
  const sizes: number[] = [];

  for (let n = 0; n < frames; n++) {
    const value = evaluateExpr(expr, { t: n / timing.fps, n });

    if (value === null) return null;

    sizes.push(Math.max(1, Math.round(value)));
  }

  return sizes;
}

function runsOf(sizes: number[]): SizeRun[] {
  const runs: SizeRun[] = [];

  for (const [frame, size] of sizes.entries()) {
    const current = runs.at(-1);

    if (current?.size === size) {
      current.last = frame;
      continue;
    }

    runs.push({ size, first: frame, last: frame });
  }

  return runs;
}

// The run's frames as an enable window; frame boundaries sit half a frame away so float time never
// lands on an edge. The first run is open at the start, the last one at the end.
function runWindow(run: SizeRun, isFirst: boolean, isLast: boolean, fps: number): string[] {
  const bounds: string[] = [];

  if (!isFirst) bounds.push(`gte(t,${((run.first - 0.5) / fps).toFixed(6)})`);

  if (!isLast) bounds.push(`lt(t,${((run.last + 0.5) / fps).toFixed(6)})`);

  return bounds;
}

function withWindow(filter: Filter, run: SizeRun, bounds: string[]): Filter {
  const values = { ...filter.values } as Record<string, unknown>;
  const authored = typeof values.enable === 'string' ? [`(${unquote(values.enable)})`] : [];
  const terms = [...authored, ...bounds];

  values.fontsize = run.size;

  if (terms.length > 0) values.enable = `'${terms.join('*')}'`;

  return { ...filter, values };
}

/**
 * A drawtext whose `fontsize` expression changes over the section, as one drawtext per run of frames
 * with the same rounded size. Any other filter, a constant size, or an expression this engine can't
 * evaluate comes back unchanged (a one-element list).
 */
export function steppedFontSize(filter: Filter, timingOf: () => FontSizeTiming): Filter[] {
  const fontsize = filter.values?.fontsize;

  if (filter.type !== 'drawtext' || typeof fontsize !== 'string' || !/\b[tn]\b/.test(fontsize)) return [filter];

  const timing = timingOf();
  const sizes = sizesPerFrame(unquote(fontsize), timing);

  if (!sizes) return [filter];

  const runs = runsOf(sizes);

  return runs.map((run, index) =>
    withWindow(filter, run, runWindow(run, index === 0, index === runs.length - 1, timing.fps))
  );
}
