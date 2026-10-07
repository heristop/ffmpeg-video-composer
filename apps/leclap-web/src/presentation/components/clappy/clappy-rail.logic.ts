import { clamp01 } from '@/presentation/components/kinetic/gradient-meter.logic';

// Where Clappy stands on the lane above a progress bar, as pure maths so the loader (ClappyRunner) and the
// home page's render track place him the same way: he rides the fill's leading edge.

/** Where he stands, as a share of his width from his left edge: between his feet (the frame's centre line). */
export const RAIL_ANCHOR = 0.5;

/**
 * His left edge in px along a lane `laneWidth` wide, so the point he stands on sits on the fill's leading
 * edge (`progress` of the lane) and never runs ahead of it. At the start he overhangs the lane's left end
 * (his back half sits behind the line, where his dust already trails); near the finish he pulls up at the
 * lane's right end so all of him stays in view, standing just behind the edge instead of past it.
 */
export const railLeft = (progress: number, laneWidth: number, size: number): number => {
  const edge = clamp01(progress) * Math.max(0, laneWidth);
  const behind = size * RAIL_ANCHOR;

  return Math.max(-behind, Math.min(edge - behind, laneWidth - size));
};
