// The goo fx's blob shapes, shared by the plan (fx-goo-plan.ts) and the seeded choreography (fx-goo-choreo.ts)
// without either importing the other.

import type { TrackKey } from '@/core/motion/tracks';

/** One value track: its keys (px, absolute times) over a resting `base` (px). */
export interface Track {
  base: number;
  keys?: TrackKey[];
}

export interface GooBlob {
  x: Track;
  y: Track;
  r: Track;
}
