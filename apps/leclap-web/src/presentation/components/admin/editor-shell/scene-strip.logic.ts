// Pure sizing for the scene strip: clips are as wide as they are long, within limits that keep a short
// clip tappable and a long one from pushing the rest off screen. Scenes with no length of their own
// (form, partial) keep a fixed card.
import type { EditorSection } from '../templateEditorModel';
import { DEFAULT_SEGMENT_DURATION } from './program-timeline.logic';

export const REM_PER_SECOND = 1.5;
export const MIN_CLIP_REM = 7.5;
export const MAX_CLIP_REM = 24;
const FIXED_CARD_REM = 7;

// A visual scene's length in seconds, or null for kinds that are not on the timeline by length.
export function sceneSeconds(section: EditorSection): number | null {
  if (section.kind !== 'video' && section.kind !== 'color' && section.kind !== 'image') return null;

  return Number.isFinite(section.duration) && section.duration > 0 ? section.duration : DEFAULT_SEGMENT_DURATION;
}

export function clipWidthRem(section: EditorSection): number {
  const seconds = sceneSeconds(section);

  if (seconds === null) return FIXED_CARD_REM;

  return Math.min(MAX_CLIP_REM, Math.max(MIN_CLIP_REM, seconds * REM_PER_SECOND));
}

// "4s", "2.5s": one decimal at most, no trailing zero.
export function secondsLabel(section: EditorSection): string | undefined {
  const seconds = sceneSeconds(section);

  if (seconds === null) return undefined;

  return `${String(Math.round(seconds * 10) / 10)}s`;
}
