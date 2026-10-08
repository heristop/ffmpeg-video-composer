// Recogniser output (seconds into the recorded clip) → `subtitles.words` (seconds into the section).
// The mapping is the engine's own (core/captions/transcript-time.ts), so a phone pin lands where a Node
// pin would: clip range, speed ramp, freezes, `options.speed` (a PTS multiplier: 2 = slow motion), the
// declared length cap, and recogniser jitter untangled. Phrase splitting and the mean confidence stay here.

import {
  mapTranscriptWords as mapEngineWords,
  transcriptEditFor,
} from 'ffmpeg-video-composer/src/core/captions/transcript-time.ts';

export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
}

/** The section options the time mapping reads (clip, speed, speedRamp, freeze, duration, keep). */
export type SectionTimeEdits = NonNullable<Parameters<typeof transcriptEditFor>[0]>;

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

export interface MappingContext {
  /** Frame rate the freezes are timed on (default 30). */
  fps?: number;
  /** The recorded clip's length, which a preset speed ramp scales to (as the engine's probe does). */
  sourceLength?: number;
}

/** Source-timed recogniser words → section-timed caption words, through the engine's mapper. */
export function mapTranscriptWords(
  words: readonly TranscriptWord[],
  options: SectionTimeEdits | undefined,
  context: MappingContext = {}
): TranscriptWord[] {
  const edit = transcriptEditFor(options, { fps: context.fps ?? 30, sourceLength: context.sourceLength });

  return mapEngineWords(words, edit);
}

/** Phrase-level recogniser output split into words sharing each phrase window by character count. */
export function spreadSegments(segments: readonly TranscriptSegment[]): TranscriptWord[] {
  return segments.flatMap((segment) => {
    const tokens = segment.text.split(/\s+/).filter(Boolean);
    const total = tokens.reduce((sum, token) => sum + token.length, 0);
    let cursor = segment.start;

    return tokens.map((token) => {
      const start = cursor;
      cursor += ((segment.end - segment.start) * token.length) / total;

      return { text: token, start: round3(start), end: round3(cursor) };
    });
  });
}

/** Mean confidence of the words that carry one, or undefined when none does. */
export function meanConfidence(words: readonly TranscriptWord[]): number | undefined {
  const scored = words.flatMap((word) => (typeof word.confidence === 'number' ? [word.confidence] : []));

  if (scored.length === 0) return undefined;

  return round3(scored.reduce((sum, value) => sum + value, 0) / scored.length);
}
