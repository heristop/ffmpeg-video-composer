// transcript_low_confidence: pinned speech-to-text words (subtitles.words with `confidence`) whose mean
// confidence is low — the recogniser was unsure, so the captions likely misread words. Advisory, on the
// motion-warnings channel: it never enters `errors`. (transcript_stale needs the clip's bytes, so the Node
// pass reports it: core/captions/transcript-pin.ts staleTranscripts.)

import type { MotionWarning } from './motion-lint';
import { subtitleAdvisories } from './subtitles-advisories';

/** Mean confidence under this reads as "review the words". */
export const LOW_TRANSCRIPT_CONFIDENCE = 0.6;
/** Fewer scored words than this is too little to judge. */
const MIN_SCORED_WORDS = 3;

type LooseWord = { confidence?: unknown } | null | undefined;

/** Mean confidence of the scored words, or null when fewer than `minScored` carry one. */
export function meanConfidence(words: readonly LooseWord[] | undefined, minScored = MIN_SCORED_WORDS): number | null {
  const scores = (words ?? []).flatMap((word) => (typeof word?.confidence === 'number' ? [word.confidence] : []));

  if (scores.length === 0 || scores.length < minScored) return null;

  return Number((scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(3));
}

type LooseSection = { name?: unknown; subtitles?: { words?: LooseWord[] } | null } | null | undefined;

function sectionWarning(section: LooseSection, index: number) {
  const mean = meanConfidence(section?.subtitles?.words);

  if (mean === null || mean >= LOW_TRANSCRIPT_CONFIDENCE) return [];

  const warning: MotionWarning = {
    path: `sections[${index}].subtitles.words`,
    code: 'transcript_low_confidence',
    severity: 'warn',
    message: `Section "${String(section?.name)}": the transcript's mean confidence is ${mean}; some captions are likely misheard`,
    hint: 'Review the words (fix the misread ones in the word editor or the JSON), or re-transcribe with a larger model.',
  };

  return [warning];
}

export function transcriptAdvisories(template: unknown): MotionWarning[] {
  const sections = (template as { sections?: unknown } | null)?.sections;

  if (!Array.isArray(sections)) return [];

  return (sections as LooseSection[]).flatMap((section, index) => sectionWarning(section, index));
}

/** Every caption advisory: the subtitle layout ones, then the pinned-transcript ones. Never throws. */
export function captionAdvisories(template: unknown): MotionWarning[] {
  return [...subtitleAdvisories(template), ...transcriptAdvisories(template)];
}
