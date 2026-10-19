// The overlay options of a layer (pure): the value handed to `overlay=`.

import type { MapAnimationInput } from '@/core/types';
import { imageOverlayEnable } from '../utils/input-sources';
import { isHtmlSequence } from '../html/html-sequence-source';

export type OverlayPlan = { legFilters: string[]; x?: string; y?: string };

/** Moving entrances use the named, single-quoted form (comma-bearing time expressions); otherwise `x:y`. */
export function overlayValue(plan: OverlayPlan, position: string, eofAction: string, timeline: string): string {
  return plan.x || plan.y
    ? `x='${plan.x}':y='${plan.y}':eof_action=${eofAction}${timeline}`
    : `${position}:eof_action=${eofAction}${timeline}`;
}

// A persistent layer holds its last frame; so does an animated html card, which plays its frames once like a
// still card would stay up.
function holdsLastFrame(input: MapAnimationInput): boolean {
  return input.options.persistent || isHtmlSequence(input);
}

/**
 * Still images ignore the -itsoffset/-t source flags animations get (their source is a bare `-loop 1`), so a
 * timed image or html layer lowers its start/duration to the overlay's timeline `enable`; animations keep the
 * source-flag path (gating them here would double-apply the delay).
 */
export function overlayOptions(input: MapAnimationInput, plan: OverlayPlan, position: string): string {
  const eofAction = holdsLastFrame(input) ? 'repeat' : 'pass';
  const timeline = input.type === 'image' || input.type === 'html' ? imageOverlayEnable(input.options) : '';

  return overlayValue(plan, position, eofAction, timeline);
}
