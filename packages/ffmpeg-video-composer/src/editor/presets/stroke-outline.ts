// The motion of the frame and corners (design 2.4 / 2.5) as stroke plans (stroke-timeline.ts).
//
// frame: the outline draws on from the top-left (`trace`: path = one head clockwise at constant speed,
// split = two heads meeting bottom-right, sides = each side a quarter of the time, fade), the newest steps
// of a travelling head drawn fainter, then it exits on $smooth (fade, retract, or expand + fade).
// corners: four brackets close in from `spread` × their rest size on the entrance curve (a spring by default,
// so they settle with a small overshoot) while their arms extend from the elbows, one after another from
// the top-left (`trace: clockwise`), then exit by expanding ~4% and fading (or fade / retract).

import { fnv1a32, seededRandom } from '@/core/determinism/hash';
import { pieceStarts, type Piece, type Span } from './stroke-path';
import { cornerPaths, framePath, inflate } from './stroke-shapes';
import { pose, type StrokePlan, type StrokePose } from './stroke-timeline';
import type { Outline } from './stroke-kit';

export type OutlinePlan = StrokePlan & {
  paths: (grow: number) => Piece[][];
  /** The entrance is an alpha ramp (trace: fade): arc sprites fade in with it. */
  fadesIn: boolean;
};

/** Exit growth as a share of the box's short side (≈ 104% for a square box). */
const EXPAND = 0.02;
/** Delay between two brackets of a clockwise trace, as a share of the entrance. */
const STAGGER = 0.1;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Alpha of an entrance ramp at progress u: f / frames for the frame showing u = (f + 1) / frames. */
function rampAlpha(o: Outline, u: number): number {
  return clamp01(u - 1 / o.entrance.frames);
}

function geometry(o: Outline, grow: number) {
  return { box: inflate(o.box, grow), thickness: o.thickness, radius: o.radius };
}

function exitPose(o: Outline, rest: Span[][], retract: (e: number) => Span[][]): StrokePlan['leave'] {
  if (!o.exit) return null;

  const short = Math.min(o.box.w, o.box.h);

  return (q, fade) => {
    const e = o.smooth(q);

    if (o.exitKind === 'retract') return pose(retract(e));

    return pose(rest, o.exitKind === 'expand' ? e * EXPAND * short : 0, fade);
  };
}

function plan(o: Outline, parts: Omit<OutlinePlan, 'fps' | 'entrance' | 'exit' | 'end'>): OutlinePlan {
  return { ...parts, fps: o.fps, entrance: o.entrance, exit: o.exit, end: o.end };
}

// Two spans mirrored about the middle of the path: [from, to] and [1 - to, 1 - from].
function halves(from: number, to: number): Span[] {
  return [
    { from, to },
    { from: 1 - to, to: 1 - from },
  ];
}

// Spans of the frame outline at eased progress p for each trace.
function frameSpans(trace: string, p: number, starts: number[]): Span[] {
  const q = clamp01(p);

  if (trace === 'split') return halves(0, q / 2);

  if (trace !== 'sides') return [{ from: 0, to: trace === 'fade' ? 1 : q }];

  // Side k is its edge plus the corner after it (pieces 2k and 2k+1).
  return [0, 1, 2, 3].map((k) => {
    const [from, to] = [starts[2 * k], starts[2 * k + 2]];

    return { from, to: from + (to - from) * clamp01(p * 4 - k) };
  });
}

// The outline undrawing from the top-left in its trace order (split: both heads' tails).
function frameRetract(trace: string, e: number): Span[][] {
  if (trace === 'split') return [halves(e / 2, 0.5)];

  return [[{ from: e, to: 1 }]];
}

export function framePlan(o: Outline): OutlinePlan {
  const g = o.request.graphic as { trace?: string };
  const trace = g.trace ?? 'path';
  const starts = pieceStarts(framePath(geometry(o, 0)));
  const rest = [frameSpans(trace, 1, starts)];

  return plan(o, {
    paths: (grow) => [framePath(geometry(o, grow))],
    fadesIn: trace === 'fade',
    headFade: trace !== 'fade',
    enter: (u) => pose([frameSpans(trace, o.curve(u), starts)], 0, trace === 'fade' ? rampAlpha(o, u) : 1),
    rest: pose(rest),
    leave: exitPose(o, rest, (e) => frameRetract(trace, e)),
  });
}

function bracket(half: number): Span[] {
  const h = Math.min(0.5, Math.max(0, half));

  return h > 0 ? [{ from: 0.5 - h, to: 0.5 + h }] : [];
}

/** Default arm length: ~18% of the short side of the target (24..160 px), varied ±10% by the seed. */
function armLength(o: Outline): number {
  const g = o.request.graphic as { length?: number; target?: unknown };

  if (g.length !== undefined) return g.length;

  if (g.target === undefined) return 72;

  const jitter = 0.9 + 0.2 * seededRandom(fnv1a32(`${o.request.seed}:corners`))();

  return Math.min(160, Math.max(24, Math.round(0.18 * Math.min(o.box.w, o.box.h) * jitter)));
}

// Brackets at entrance progress u: closing in by `travel` px, arms extending (staggered when clockwise).
function cornersPose(o: Outline, motion: { trace: string; travel: number; stagger: number }, u: number): StrokePose {
  const grow = motion.travel * (1 - o.curve(u));

  const full = [0, 1, 2, 3].map(() => bracket(0.5));

  if (motion.trace === 'fade') return pose(full, grow, rampAlpha(o, u));

  const spans = [0, 1, 2, 3].map((i) => {
    const local = clamp01((u - i * motion.stagger) / (1 - 3 * motion.stagger));

    return bracket(o.curve(local) / 2);
  });

  return pose(spans, grow);
}

export function cornersPlan(o: Outline): OutlinePlan {
  const g = o.request.graphic as { trace?: string; spread?: number };
  const trace = g.trace ?? 'clockwise';
  const length = armLength(o);
  const travel = (((g.spread ?? 1.06) - 1) * Math.min(o.box.w, o.box.h)) / 2;
  const stagger = trace === 'clockwise' ? STAGGER : 0;
  const full = [0, 1, 2, 3].map(() => bracket(0.5));

  return plan(o, {
    paths: (grow) => cornerPaths(geometry(o, grow), length),
    fadesIn: trace === 'fade',
    headFade: trace !== 'fade',
    enter: (u) => cornersPose(o, { trace, travel, stagger }, u),
    rest: pose(full),
    leave: exitPose(o, full, (e) => full.map(() => bracket((1 - e) / 2))),
  });
}
