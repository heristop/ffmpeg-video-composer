// Kinetic echo trail: a unit's motion smear. Each echo is the unit's own drawtext read on a delayed
// clock (t − i·delta), so it follows the exact same tracks a few frames late, at a lower opacity. When
// the unit rests, every echo has converged onto it; the echoes are only enabled while the unit moves
// (entrance, then exit), so no stacked copies thicken the resting glyph edges. No new filters.

import type { Filter } from '@/core/types';
import type { KineticBlock } from '../../schemas/kinetic.schemas';
import { fmt } from '@/core/motion/hermite';

/** Most echo drawtexts one block may add: fewer echoes per unit on long copy. */
export const MAX_TRAIL_FILTERS = 192;
const DEFAULT_DELTA = 0.04;
const DEFAULT_FADE = 0.5;

export interface TrailTiming {
  start: number;
  arrive: number;
  leave: { at: number; duration: number } | null;
}

function echoCount(echoes: number, units: number): number {
  return Math.min(echoes, Math.floor(MAX_TRAIL_FILTERS / Math.max(1, units)));
}

function motionWindows(timing: TrailTiming, lag: number): string {
  const entrance = `between(t,${fmt(timing.start)},${fmt(timing.arrive + lag)})`;
  const exit = timing.leave
    ? `+between(t,${fmt(timing.leave.at)},${fmt(timing.leave.at + timing.leave.duration + lag)})`
    : '';

  return `'${entrance}${exit}'`;
}

function unquoted(value: unknown): string {
  const text = String(value);

  return text.startsWith("'") && text.endsWith("'") ? text.slice(1, -1) : text;
}

/**
 * The echoes of one unit, farthest first (drawn beneath the nearer ones and the unit itself). `draw`
 * builds the unit's drawtext on a given clock expression.
 */
export function trailEchoes(
  block: KineticBlock,
  units: number,
  draw: (time: string) => Filter,
  timing: TrailTiming
): Filter[] {
  const trail = block.trail;

  if (!trail || block.preset === 'counter') return [];

  const delta = trail.delta ?? DEFAULT_DELTA;
  const fade = trail.fade ?? DEFAULT_FADE;
  const count = echoCount(trail.echoes, units);

  return Array.from({ length: count }, (_, k) => count - k).map((i) => {
    const lag = i * delta;
    const filter = draw(`(t-${fmt(lag)})`);
    const values = { ...filter.values } as Record<string, unknown>;
    values.alpha = `'(${unquoted(values.alpha)})*${fmt(fade ** i)}'`;
    values.enable = motionWindows(timing, lag);

    return { ...filter, values };
  });
}
