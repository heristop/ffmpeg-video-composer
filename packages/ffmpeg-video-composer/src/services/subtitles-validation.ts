// Descriptor rules for word-timed subtitles (sections[].subtitles):
//
// - invalid_srt: an SRT block without a readable timing line, or ending before it starts.
// - invalid_word_timings: a word ending before it starts, or starting before the previous word ended.
// - invalid_subtitle_cue: an authored cue whose end is not after its start.
// - subtitle_font_unmeasurable: a font override that is not bundled, so words can't be laid out.

import type { TemplateDescriptor } from '../schemas/template.schemas';
import type { Subtitles, WordTimingInput } from '../schemas/subtitles.schemas';
import { FONT_ADVANCES } from '@/core/font-advances.generated';
import { parseSrt } from '@/core/captions/srt';
import { subtitleFontFile } from '@/core/captions/style';
import type { ValidationError } from './validation/types';

/** Two words may share this much time (speech-to-text boundaries jitter) before it is an overlap. */
const OVERLAP_TOLERANCE = 0.02;

function wordErrors(words: readonly WordTimingInput[] | undefined, path: string): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const [index, word] of (words ?? []).entries()) {
    const previous = index > 0 ? (words as WordTimingInput[])[index - 1] : undefined;
    const at = `${path}[${index}]`;

    if (word.end < word.start) {
      errors.push({ path: at, message: `"${word.text}" ends before it starts`, code: 'invalid_word_timings' });
    }

    if (previous && word.start < previous.end - OVERLAP_TOLERANCE) {
      errors.push({
        path: at,
        message: `"${word.text}" starts at ${word.start}s, before "${previous.text}" ends (${previous.end}s): words must be in time order without overlapping`,
        code: 'invalid_word_timings',
        hint: 'Sort the words by start time and trim overlapping ends.',
        kind: 'judgement',
      });
    }
  }

  return errors;
}

function srtErrors(srt: string | undefined, path: string): ValidationError[] {
  if (srt === undefined) return [];

  return parseSrt(srt).errors.map((error) => ({
    path,
    message: `line ${error.line}: ${error.message}`,
    code: 'invalid_srt',
    hint: 'Each block is an optional index, a "00:00:01,000 --> 00:00:02,500" line, then the text.',
  }));
}

function cueErrors(subtitles: Subtitles, path: string): ValidationError[] {
  return (subtitles.cues ?? []).flatMap((cue, index) => {
    const at = `${path}.cues[${index}]`;
    const inverted = typeof cue.at === 'number' && typeof cue.end === 'number' && cue.end <= cue.at;
    const own: ValidationError[] = inverted
      ? [
          {
            path: `${at}.end`,
            message: `cue ends (${cue.end}s) before it starts (${cue.at}s)`,
            code: 'invalid_subtitle_cue',
          },
        ]
      : [];

    return [...own, ...wordErrors(cue.words, `${at}.words`)];
  });
}

function fontErrors(subtitles: Subtitles, path: string): ValidationError[] {
  if (subtitles.font === undefined || Object.hasOwn(FONT_ADVANCES, subtitleFontFile(subtitles.font))) return [];

  return [
    {
      path: `${path}.font`,
      message: `"${subtitles.font}" is not a bundled font, so subtitles can't be laid out`,
      code: 'subtitle_font_unmeasurable',
      hint: 'Use a bundled font id (rubik, oswald, bebas, anton, righteous…) or drop the override to use the DNA font.',
      kind: 'judgement',
    },
  ];
}

export function validateSubtitles(template: TemplateDescriptor): ValidationError[] {
  return (template.sections ?? []).flatMap((section, index) => {
    const subtitles = 'subtitles' in section ? section.subtitles : undefined;

    if (!subtitles) return [];

    const path = `sections[${index}].subtitles`;

    return [
      ...srtErrors(subtitles.srt, `${path}.srt`),
      ...wordErrors(subtitles.words, `${path}.words`),
      ...cueErrors(subtitles, path),
      ...fontErrors(subtitles, path),
    ];
  });
}
