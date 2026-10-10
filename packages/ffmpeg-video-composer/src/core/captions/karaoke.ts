// Karaoke timing shared by both subtitle renderers (editor/presets/subtitles.ts draws it with drawtext,
// core/captions/caption-frames.ts samples it into raster states): when each word of a cue is the spoken
// one, and the eased curve of a pop. Pure.

import { parseEasing } from '../motion/easing';
import type { PlacedCue, PlacedWord } from './place';

/** A silence shorter than this keeps the previous word active, so the highlight doesn't flicker. */
export const ACTIVE_BRIDGE = 0.25;
/** How long the pop bump of the spoken word lasts. */
export const POP_SECONDS = 0.24;
export const POP_EASE = parseEasing('ease-out-cubic');

export interface ActiveSpan {
  from: number;
  to: number;
}

// When the word is the active one: from its start to its end (or on to the next word across a short
// silence), inside the cue.
export function activeWindow(cue: PlacedCue, words: readonly PlacedWord[], index: number): ActiveSpan {
  const word = words[index];
  const next = words.at(index + 1);
  const bridged = next && next.start - word.end < ACTIVE_BRIDGE ? next.start : word.end;

  return { from: Math.max(cue.start, word.start), to: Math.min(cue.end, Math.max(bridged, word.start + 0.04)) };
}

/** The pop bump at `elapsed` seconds into the word's active window: 0 → 1 (peak) → 0, eased. */
export function popBump(elapsed: number): number {
  if (elapsed < 0 || elapsed >= POP_SECONDS) return 0;

  return Math.sin(Math.PI * POP_EASE.fn(elapsed / POP_SECONDS));
}
