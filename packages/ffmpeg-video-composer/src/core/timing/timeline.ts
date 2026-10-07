// Whole-video time for beat anchors: where each section starts in the final timeline, and when beat n /
// bar n falls on the global beat grid. Pure; mirrors the director's assembly (a transition overlaps the
// two clips it joins, capped to half the shorter one, see editor/utils/transition-graph.ts).

import { DEFAULT_TRANSITION_DURATION } from '../../schemas/effects.schemas';
import DefaultConfig from '../default.config';
import { footagePlan, hasFootageEdits, type FootageOptions } from '../footage/plan';

/** What an analysis adds to a grid: its confidence, and whether the pulse is reliable enough to cut on. */
interface AnalysisMarks {
  confidence?: number;
  usable?: boolean;
}

/** A tempo grid (`bpm`, first beat at `offset`) or explicit beat times from an analysis, in video seconds. */
export type Beats =
  | ({ bpm: number; offset?: number; beatsPerBar?: number } & AnalysisMarks)
  | ({ times: number[]; beatsPerBar?: number } & AnalysisMarks);

/** A request to measure the grid from the template's music track at compile time (Node only). */
export interface BeatsAnalysisRequest {
  analyze: 'music';
  beatsPerBar?: number;
}

/** `global.beats` as authored: a grid, or a request to analyze the music. */
export type BeatsSpec = Beats | BeatsAnalysisRequest;

export function isAnalysisRequest(beats: unknown): beats is BeatsAnalysisRequest {
  return typeof beats === 'object' && beats !== null && (beats as { analyze?: unknown }).analyze === 'music';
}

// The footage options that fix a clip's length before probing: clip/ramp/freeze edits and keep windows.
type TakeLengthOptions = FootageOptions & { keep?: Array<[number, number]>; trimSilence?: unknown };

interface TimelineTransition {
  type: string;
  duration?: number;
}

export interface TimelineSection {
  type: string;
  // `duration` may still be an unresolved `{ beats }` / `{ bars }` length (core/timing/durations.ts).
  options?: Omit<TakeLengthOptions, 'duration'> & { duration?: unknown };
  transition?: TimelineTransition;
}

// Sections that become clips in the final timeline (effect sections are resolved into clips first).
export const RENDERED = new Set(['video', 'project_video', 'image_background', 'color_background', 'effect']);

/** Video time of beat `index` (1-based), or null when the grid has no such beat. */
export function beatTime(beats: Beats, index: number): number | null {
  if ('times' in beats) return beats.times.at(index - 1) ?? null;

  return (beats.offset ?? 0) + ((index - 1) * 60) / beats.bpm;
}

/** Video time of the downbeat of bar `index` (1-based). */
export function barTime(beats: Beats, index: number): number | null {
  return beatTime(beats, (index - 1) * (beats.beatsPerBar ?? 4) + 1);
}

// The edited length of an unprobed clip, tolerating an unvalidated descriptor (a malformed ease or key
// leaves the declared duration in charge; validation reports the field itself).
function editedLength(options: FootageOptions): number | undefined {
  try {
    return footagePlan(options, undefined, DefaultConfig.FPS)?.length;
  } catch {
    return undefined;
  }
}

/**
 * The section's length when it is known before any media is probed: its `options.duration`, except for a
 * recorded clip (`project_video`), whose length comes from the probe, and a silence-trimmed take, whose
 * length comes from the analysis. A `video` section whose footage edits fix its length (a clip range
 * with an out-point, timed on the default frame grid, or explicit `keep` windows) is capped at it.
 */
export function knownDuration(section: TimelineSection): number | undefined {
  const options = section.options;

  if (section.type === 'project_video' || options?.trimSilence !== undefined) return undefined;

  const declared = options?.duration;

  // A `{ beats }` / `{ bars }` length is only a number once core/timing/durations.ts resolved it.
  if (declared !== undefined && typeof declared !== 'number') return undefined;

  const edited = section.type === 'video' ? videoEditedLength({ ...options, duration: declared }) : undefined;

  if (edited === undefined) return declared;

  return declared === undefined ? edited : Math.min(declared, edited);
}

// The length a `video` section's own edits fix: the kept windows' sum, or the clip-range edit.
function videoEditedLength(options: TakeLengthOptions): number | undefined {
  const keep = options.keep;

  if (keep && keep.length > 0) return keep.reduce((sum, [from, to]) => sum + Math.max(0, to - from), 0);

  return hasFootageEdits(options) ? editedLength(options) : undefined;
}

// How far the boundary after `previous` pulls the next section back: a transition overlaps both clips.
function boundaryOverlap(
  previous: { section: TimelineSection; duration: number | undefined },
  next: number | undefined,
  globalTransition: TimelineTransition | undefined
): number | null {
  const declared = previous.section.transition ?? globalTransition;

  if (!declared || declared.type === 'cut') return 0;

  if (previous.duration === undefined || next === undefined) return null;

  const duration = declared.duration ?? globalTransition?.duration ?? DEFAULT_TRANSITION_DURATION;

  return Math.min(duration, Math.min(previous.duration, next) / 2);
}

/**
 * Start of each section in the final video, by descriptor index: null for a section that is not rendered,
 * or whose start depends on a length only known once media is probed.
 */
export function sectionStarts(
  sections: readonly TimelineSection[],
  globalTransition?: TimelineTransition
): Array<number | null> {
  const starts: Array<number | null> = sections.map(() => null);
  let cursor: number | null = 0;
  let previous: { section: TimelineSection; duration: number | undefined } | undefined;

  for (const [index, section] of sections.entries()) {
    if (!RENDERED.has(section.type)) continue;

    const duration = knownDuration(section);
    const shift = previous ? boundaryOverlap(previous, duration, globalTransition) : 0;
    const start: number | null = cursor === null || shift === null ? null : cursor - shift;

    starts[index] = start;
    cursor = start === null || duration === undefined ? null : start + duration;
    previous = { section, duration };
  }

  return starts;
}
