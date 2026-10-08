// Transcript time mapping: a recogniser times words in SOURCE seconds (into the clip file), captions are
// drawn in SECTION seconds. The section's footage edits sit between the two, in the same order the
// lowering applies them (core/footage/plan.ts): the clip range or the kept take windows, then the speed
// ramp, then the freeze holds, then `options.speed` (a PTS multiplier: 2 = half rate), capped by the
// declared length. Pure and deterministic (millisecond-rounded), so a pin is reproducible.

import type { KeepRange } from '../types';
import { footagePlan, type FootageOptions, type FreezePlan, type RampPiece } from '../footage/plan';
import { sourceLengthFor, type SourceLengthSection } from '../footage/source-length';

export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface TranscriptEdit {
  /** Clip in-point / out-point, source seconds. */
  from?: number;
  to?: number;
  /** Kept take windows, source seconds (exclusive with the clip range / ramp / freezes). */
  keep?: readonly KeepRange[];
  pieces?: readonly RampPiece[] | null;
  freezes?: readonly FreezePlan[];
  fps?: number;
  /** options.speed, the PTS multiplier. */
  speed?: number;
  /** Declared section length: words past it are cut. */
  duration?: number;
}

type Window = { from: number; to: number; offset: number };

function ms(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function windows(edit: TranscriptEdit): Window[] {
  if (edit.keep && edit.keep.length > 0) {
    let offset = 0;

    return edit.keep.map(([from, to]) => {
      const window = { from, to, offset };
      offset += to - from;

      return window;
    });
  }

  return [{ from: edit.from ?? 0, to: edit.to ?? Number.POSITIVE_INFINITY, offset: 0 }];
}

// Output time of a source time under a ramp: the inverse of core/footage/plan.ts sourceAt.
function rampOutput(pieces: readonly RampPiece[] | null | undefined, source: number): number {
  if (!pieces || pieces.length === 0) return source;

  let piece = pieces[0];

  for (const candidate of pieces) {
    if (candidate.s0 <= source) piece = candidate;
  }

  return piece.o0 + (source - piece.s0) / piece.speed;
}

// Sound time of a ramp time: every hold at or before it pushes the picture later, but only a hold that
// pauses the sound pushes the speech (audio 'continue' plays on under the frozen frame, as in
// editor/utils/footage-lowering.ts audioParts).
function withHolds(rampTime: number, freezes: readonly FreezePlan[] | undefined, fps: number): number {
  let picture = rampTime;
  let paused = 0;

  for (const freeze of freezes ?? []) {
    if (picture <= freeze.frame / fps) continue;

    picture += freeze.frames / fps;

    if (freeze.audio !== 'continue') paused += freeze.frames / fps;
  }

  return rampTime + paused;
}

function toSection(edit: TranscriptEdit, window: Window, source: number): number {
  const local = window.offset + Math.min(Math.max(source, window.from), window.to) - window.from;
  const held = withHolds(rampOutput(edit.pieces, local), edit.freezes, edit.fps ?? 30);

  return held * (edit.speed ?? 1);
}

function mapWord(edit: TranscriptEdit, all: Window[], word: TranscriptWord): TranscriptWord | null {
  const mid = (word.start + word.end) / 2;
  const window = all.find((candidate) => mid >= candidate.from && mid < candidate.to);

  if (!window) return null;

  const start = ms(toSection(edit, window, word.start));
  const end = ms(Math.min(toSection(edit, window, word.end), edit.duration ?? Number.POSITIVE_INFINITY));

  if (edit.duration !== undefined && start >= edit.duration) return null;

  return { ...word, start, end: Math.max(start, end) };
}

// Recognisers jitter at word boundaries: order by start and never let a word begin before the last ended.
function untangle(words: TranscriptWord[]): TranscriptWord[] {
  const sorted = [...words].sort((a, b) => a.start - b.start);

  return sorted.map((word, index) => {
    const previous = index > 0 ? sorted[index - 1] : undefined;
    const start = previous && word.start < previous.end ? previous.end : word.start;

    return { ...word, start, end: Math.max(start, word.end) };
  });
}

/** Source-timed recogniser words → section-timed caption words, edits applied, outside words dropped. */
export function mapTranscriptWords(words: readonly TranscriptWord[], edit: TranscriptEdit): TranscriptWord[] {
  const all = windows(edit);
  const mapped = words.flatMap((word) => {
    const text = word.text.trim();
    const result = text ? mapWord(edit, all, { ...word, text }) : null;

    return result ? [result] : [];
  });

  return untangle(mapped);
}

export interface TranscriptEditContext {
  fps: number;
  /** Probed source length (scales a preset ramp). */
  sourceLength?: number;
  /** Kept windows the take plan resolved (trimSilence), overriding options.keep. */
  keep?: readonly KeepRange[];
}

type SectionOptions = FootageOptions & { speed?: number; keep?: readonly KeepRange[] };

/** The edit a section's options apply between its clip and its timeline. */
export function transcriptEditFor(options: SectionOptions | undefined, context: TranscriptEditContext): TranscriptEdit {
  const opts = options ?? {};
  const keep = context.keep ?? opts.keep;
  const plan = footagePlan(opts, context.sourceLength, context.fps);

  return {
    from: opts.clip?.from,
    to: opts.clip?.to,
    ...(keep === undefined ? {} : { keep }),
    pieces: plan?.pieces ?? null,
    freezes: plan?.freezes ?? [],
    fps: context.fps,
    speed: opts.speed,
    duration: opts.duration,
  };
}

export interface SectionEditContext {
  fps: number;
  /** Probed clip lengths by section name (the director's buildInfos.sourceDurations). */
  lengths?: Partial<Record<string, number>>;
  /** Kept windows the take plan resolved (trimSilence). */
  keep?: readonly KeepRange[];
}

/**
 * The edit of a section, its source length picked by the lowering's rule (core/footage/source-length.ts):
 * what the render pass and `leclap transcribe` both pin through.
 */
export function sectionTranscriptEdit(section: SourceLengthSection, context: SectionEditContext): TranscriptEdit {
  return transcriptEditFor(section.options as SectionOptions | undefined, {
    fps: context.fps,
    sourceLength: sourceLengthFor(section, context.lengths),
    ...(context.keep === undefined ? {} : { keep: context.keep }),
  });
}
