// Volume automation: a list of `{ at, volume, ease? }` keys lowered to one `volume` filter whose gain is
// a per-frame expression in `t`. Each key eases INTO itself from the previous one through the same
// lowering keyframe tracks use (core/motion/tracks.ts → hermite.ts), so springs and beziers cost a few
// multiply-adds per audio frame; before the first key the first volume holds, after the last the last.
// Times are already seconds (the time-reference pass resolved them). Pure.

import type { EasingSpec } from '../motion/easing';
import { trackExpr, type TrackKey } from '../motion/tracks';

export interface AutomationKey {
  at: number;
  volume: number;
  ease?: EasingSpec;
}

// A key repeated at (or before) the previous time becomes a 1 ms step: the track lowering needs strictly
// increasing times.
const MIN_STEP = 0.001;

/** The keys as a track in time order (stable for equal times, so the later key wins from that instant). */
function automationTrack(keys: readonly AutomationKey[]): TrackKey[] {
  const sorted = [...keys].sort((a, b) => a.at - b.at);
  const track: Array<TrackKey & { t: number }> = [];

  for (const key of sorted) {
    const previous = track.at(-1)?.t;
    const t = previous !== undefined && key.at <= previous ? previous + MIN_STEP : key.at;

    track.push({ t, v: key.volume, ease: key.ease });
  }

  return track;
}

/** The gain expression over time `t` (unquoted), or null for no keys. Never negative (springs overshoot). */
export function automationExpr(keys: readonly AutomationKey[]): string | null {
  if (keys.length === 0) return null;

  return `max(0,${trackExpr(automationTrack(keys))})`;
}

/** The `volume` filter applying the automation, or null for no keys. */
export function automationFilter(keys: readonly AutomationKey[] | undefined): string | null {
  const expr = keys ? automationExpr(keys) : null;

  return expr === null ? null : `volume=eval=frame:volume='${expr}'`;
}
