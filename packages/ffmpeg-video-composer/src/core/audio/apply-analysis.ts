// Puts a music analysis into a template: `global.beats` becomes the analysed grid, and the section playing
// when the drop hits gets a `drop` cue (section-local seconds) for "cue:drop" references. Shared by the
// Node compile (`global.beats: { analyze: 'music' }`) and the web builder (library tracks and uploads).
// Pure: returns a new descriptor and never overrides what the author wrote.

import { resolveSectionDurations } from '../timing/durations';
import { isAnalysisRequest, knownDuration, sectionStarts, type Beats, type TimelineSection } from '../timing/timeline';
import type { BeatAnalysis } from './beats';

/** What a stored analysis keeps (the music library's generated table holds exactly this). */
export type MusicAnalysis = Pick<BeatAnalysis, 'bpm' | 'offset' | 'beatsPerBar' | 'confidence' | 'usable' | 'cues'> & {
  times?: number[];
};

export interface ApplyAnalysisOptions {
  /**
   * Fill `global.beats` when the template has none (default true). Only a usable grid is added unasked;
   * a `{ analyze: 'music' }` request is always answered.
   */
  fillMissing?: boolean;
}

type Bag = Record<string, unknown>;
type Descriptor = { global?: unknown; sections?: unknown };

/** The `global.beats` grid of an analysis. */
export function beatsFromAnalysis(analysis: MusicAnalysis): Beats {
  return {
    bpm: analysis.bpm,
    offset: analysis.offset,
    beatsPerBar: analysis.beatsPerBar,
    confidence: analysis.confidence,
    usable: analysis.usable,
  };
}

function withBeats<T extends Descriptor>(descriptor: T, analysis: MusicAnalysis, options: ApplyAnalysisOptions): T {
  const global = (descriptor.global ?? {}) as Bag;
  const requested = isAnalysisRequest(global.beats);
  const missing = global.beats === undefined && (options.fillMissing ?? true) && analysis.usable;

  if (!requested && !missing) return descriptor;

  return { ...descriptor, global: { ...global, beats: beatsFromAnalysis(analysis) } };
}

// The rendered section on screen at video time `at`, and that time in its own seconds.
function sectionAt(descriptor: Descriptor, at: number): { index: number; local: number } | null {
  const sections = (resolveSectionDurations(descriptor).descriptor.sections ?? []) as TimelineSection[];
  const transition = (descriptor.global as { transition?: { type: string; duration?: number } } | undefined)
    ?.transition;
  const starts = sectionStarts(sections, transition);
  const found = sections.findIndex((section, index) => {
    const start = starts[index];
    const length = knownDuration(section);

    return start !== null && length !== undefined && at >= start && at < start + length;
  });

  return found === -1 ? null : { index: found, local: Number((at - (starts[found] ?? 0)).toFixed(3)) };
}

function withDropCue<T extends Descriptor>(descriptor: T, drop: number | undefined): T {
  if (drop === undefined || !Array.isArray(descriptor.sections)) return descriptor;

  const target = sectionAt(descriptor, drop);
  const section = target ? (descriptor.sections[target.index] as Bag) : null;
  const cues = (section?.cues ?? {}) as Record<string, number>;

  if (!target || !section || Object.hasOwn(cues, 'drop')) return descriptor;

  const sections = [...(descriptor.sections as Bag[])];

  sections[target.index] = { ...section, cues: { ...cues, drop: target.local } };

  return { ...descriptor, sections };
}

/** The descriptor with the analysed beat grid and the drop cue filled in where the author left them out. */
export function applyMusicAnalysis<T extends Descriptor>(
  descriptor: T,
  analysis: MusicAnalysis,
  options: ApplyAnalysisOptions = {}
): T {
  return withDropCue(withBeats(descriptor, analysis, options), analysis.cues.drop);
}
