// Section lengths counted in beats: `options.duration: { beats: 8 }` or `{ bars: 2 }` becomes seconds on
// the tempo of `global.beats` (`{ bpm }`), before section starts and time references are computed
// (core/timing/resolve.ts), so a cut lands on the grid without any arithmetic in the template. While the
// grid still awaits a music analysis (`{ analyze: 'music' }`) the length is deferred, not an error. Pure.

import { isAnalysisRequest, type BeatsSpec } from './timeline';

export type BeatDuration = { beats: number } | { bars: number };

export interface DurationIssue {
  path: string;
  code: 'beat_duration_needs_bpm';
  message: string;
  hint: string;
}

type Bag = Record<string, unknown>;

export function isBeatDuration(value: unknown): value is BeatDuration {
  if (typeof value !== 'object' || value === null) return false;

  return typeof (value as Bag).beats === 'number' || typeof (value as Bag).bars === 'number';
}

/** Seconds of a beat length on `beats`; 'deferred' while the grid awaits analysis; null without a bpm. */
export function beatDurationSeconds(duration: BeatDuration, beats: BeatsSpec | undefined): number | 'deferred' | null {
  if (isAnalysisRequest(beats)) return 'deferred';

  if (!beats || !('bpm' in beats)) return null;

  const count = 'beats' in duration ? duration.beats : duration.bars * (beats.beatsPerBar ?? 4);

  return Number(((count * 60) / beats.bpm).toFixed(6));
}

export interface DurationResolution<T> {
  descriptor: T;
  issues: DurationIssue[];
  /** Indices of the sections whose length waits for the music analysis. */
  deferred: Set<number>;
}

function sectionDuration(section: Bag): unknown {
  return (section.options as Bag | undefined)?.duration;
}

/**
 * The descriptor with every `{ beats }` / `{ bars }` section length turned into seconds, the lengths
 * that cannot be (no bpm on the grid), and the ones deferred to the analysis. Sections without a beat
 * length are returned untouched.
 */
export function resolveSectionDurations<T extends { global?: unknown; sections?: unknown }>(
  descriptor: T
): DurationResolution<T> {
  const deferred = new Set<number>();
  const issues: DurationIssue[] = [];

  if (!Array.isArray(descriptor.sections)) return { descriptor, issues, deferred };

  const beats = (descriptor.global as { beats?: BeatsSpec } | undefined)?.beats;
  const sections = (descriptor.sections as Bag[]).map((section, index) => {
    const duration = sectionDuration(section);

    if (!isBeatDuration(duration)) return section;

    const seconds = beatDurationSeconds(duration, beats);

    if (typeof seconds === 'number') return { ...section, options: { ...(section.options as Bag), duration: seconds } };

    if (seconds === 'deferred') deferred.add(index);

    if (seconds === null) {
      issues.push({
        path: `sections[${index}].options.duration`,
        code: 'beat_duration_needs_bpm',
        message: 'a section length in beats or bars needs global.beats with a bpm',
        hint: 'add global.beats { bpm, offset? } (or { analyze: "music" } on Node), or give the length in seconds',
      });
    }

    return section;
  });

  return { descriptor: { ...descriptor, sections }, issues, deferred };
}
