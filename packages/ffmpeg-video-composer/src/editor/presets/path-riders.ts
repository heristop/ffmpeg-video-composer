// What rides the drawing end of a path graphic: an optional dot (head) and, for round caps, a cap disc of the
// stroke's width that rounds the end while the stroke is cut short. Each is one compile-time disc sprite
// overlaid once for the graphic's life: its x/y are step functions of t sampled once per output frame along
// the arc-length parameterisation, written as a balanced tree of ifs (a 10 s draw at 60 fps is 600 steps; a
// flat chain or a sum of windows would not parse), and its steps are contiguous, so one enable window covers
// them. Filters: fps, colorchannelmixer, fade, overlay.

import type { FilterGraphChain } from '@/core/types';
import { fmt } from '@/core/motion/hermite';
import { pointAt, type Pt } from './path-geometry';
import { addStep, type SpriteStep } from './stroke-lower';
import { even, spriteInput } from './stroke-kit';
import {
  alphaFilters,
  fadeOut,
  paintOf,
  settledAt,
  window,
  type Paint,
  type PathRequest,
  type Plan,
} from './path-plan';

interface Rider {
  key: 'cap' | 'tail' | 'head';
  size: number;
  paint: Paint;
}

// Step edges sit half a frame early (like the reveal's lut windows), so a frame time never lands on an edge
// rounded in the expression and picks a neighbour.
function edge(p: Plan, frame: number): number {
  return p.entrance.start + (frame - 0.5) / p.fps;
}

// The top-left of a `size` disc centred on the drawing end at `fraction`.
function place(p: Plan, fraction: number, size: number): { x: number; y: number } {
  const at = pointAt(p.traced, fraction);

  return { x: Math.round(at.x - size / 2), y: Math.round(at.y - size / 2) };
}

/** Where a disc of `size` px sits on each frame: on the drawing end, then held; nothing past its life. */
export function riderSteps(p: Plan, size: number): SpriteStep[] {
  const steps: SpriteStep[] = [];

  for (const [f, head] of p.heads.entries()) {
    addStep(steps, { from: edge(p, f), to: edge(p, f + 1), ...place(p, head, size) });
  }

  if (p.end === undefined || p.end > settledAt(p)) {
    const to = p.end === undefined ? undefined : p.end - 0.5 / p.fps;

    addStep(steps, { from: edge(p, p.entrance.frames), to, ...place(p, p.heads.at(-1) as number, size) });
  }

  if (p.end === undefined) return steps;

  // An `until` inside the draw cuts it short.
  return cutAt(steps, p.end - 0.5 / p.fps);
}

function isLoop(p: Plan): boolean {
  const points = p.traced.subpaths.length === 1 ? p.traced.subpaths[0] : [];

  if (points.length <= 2) return false;

  const [first, last] = [points[0], points.at(-1) as Pt];

  return Math.hypot(first.x - last.x, first.y - last.y) < 1e-6;
}

// When the drawing end first reaches the path's end, or Infinity when it never does.
function fullAt(p: Plan): number {
  const frame = p.heads.findIndex((head) => head >= 1);

  return frame === -1 ? Infinity : edge(p, frame);
}

function headRider(request: PathRequest, p: Plan, paint: Paint): Rider | null {
  const head = request.graphic.head;

  if (!head) return null;

  const options = typeof head === 'object' ? head : {};

  return {
    key: 'head',
    size: even(options.size ?? Math.max(8, p.thickness * 2.4)),
    paint: paintOf(request, options.color, paint.hex),
  };
}

function riders(request: PathRequest, p: Plan, paint: Paint): Rider[] {
  const head = headRider(request, p, paint);
  // Opaque strokes only: a translucent cap would double the stroke under it.
  const round = (request.graphic.caps ?? 'round') === 'round' && paint.alpha >= 1;
  const cap: Rider | null =
    round && (!head || head.size < p.thickness)
      ? { key: 'cap', size: Math.max(2, Math.round(p.thickness)), paint }
      : null;

  // A closed loop has no cap at its start: while it is cut short, a disc rounds that end too.
  const tail: Rider | null = cap && isLoop(p) ? { ...cap, key: 'tail' } : null;

  return [tail, cap, head].filter((rider): rider is Rider => rider !== null);
}

// A step function of t as a balanced tree of ifs (depth log2 of the steps).
function stepTree(steps: SpriteStep[], value: (step: SpriteStep) => number): string {
  if (steps.every((step) => value(step) === value(steps[0]))) return fmt(value(steps[0]));

  const mid = Math.floor(steps.length / 2);
  const [before, after] = [stepTree(steps.slice(0, mid), value), stepTree(steps.slice(mid), value)];

  return `if(lt(t,${fmt(steps[mid].from)}),${before},${after})`;
}

// Steps cut off when the drawing end reaches the path's end: the cover's own cap (or the joint of a loop)
// takes over there.
function untilFull(p: Plan, steps: SpriteStep[]): SpriteStep[] {
  return cutAt(steps, fullAt(p));
}

// Steps before `stop` (Infinity: all of them), the last one ending there.
function cutAt(steps: SpriteStep[], stop: number): SpriteStep[] {
  if (stop === Infinity) return steps;

  return steps.filter((step) => step.from < stop).map((step) => ({ ...step, to: Math.min(step.to ?? stop, stop) }));
}

function stepsOf(p: Plan, rider: Rider): SpriteStep[] {
  const steps = riderSteps(p, rider.size);

  if (rider.key === 'head') return steps;

  if (rider.key === 'cap') return untilFull(p, steps);

  // The tail sits on the start until the loop closes, or until a retract starts moving the start.
  const tail = steps.map((step) => ({ ...step, ...place(p, 0, rider.size) }));
  const moves = p.retract && p.exit ? p.exit.start - 0.5 / p.fps : Infinity;

  return cutAt(untilFull(p, tail), moves);
}

// One disc over `base`; [] when it never shows, null when its sprite cannot be registered.
function riderChain(request: PathRequest, p: Plan, rider: Rider, base: string): FilterGraphChain[] | null {
  const spec = { kind: 'piece' as const, shape: 'disc' as const, w: rider.size, h: rider.size };
  const steps = stepsOf(p, rider);

  if (steps.length === 0) return [];

  const sprite = spriteInput(request)(rider.key, { ...spec, color: rider.paint.hex.slice(1) });

  if (!sprite) return null;

  const out = `gs${request.index}_${rider.key}`;
  const at = `x='${stepTree(steps, (s) => s.x)}':y='${stepTree(steps, (s) => s.y)}'`;
  const span = window(steps[0].from, (steps.at(-1) as SpriteStep).to);
  const fade = p.exit ? [fadeOut(p.exit, p.fps)] : [];

  return [
    {
      inputs: [sprite],
      filters: [{ type: 'fps', value: String(p.fps) }, ...alphaFilters(rider.paint), ...fade],
      outputs: [`${out}a`],
    },
    { inputs: [base, `${out}a`], filters: [{ type: 'overlay', value: `${at}:enable='${span}'` }], outputs: [out] },
  ];
}

/** Every rider overlaid in turn over `base`; null when a sprite cannot be registered. */
export function riderChains(request: PathRequest, p: Plan, paint: Paint, base: string): FilterGraphChain[] | null {
  const chains: FilterGraphChain[] = [];

  for (const rider of riders(request, p, paint)) {
    const chain = riderChain(request, p, rider, chains.at(-1)?.outputs?.[0] ?? base);

    if (!chain) return null;

    chains.push(...chain);
  }

  return chains;
}
