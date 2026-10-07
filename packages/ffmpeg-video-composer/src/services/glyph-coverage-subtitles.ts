// The text a subtitle track draws, for the glyph-coverage check (glyph-coverage.ts): every authored cue,
// every SRT cue and every timed word, in the track's font (its override or the DNA's) and case.

import { captionDna } from '@/core/captions/dna';
import { parseSrt } from '@/core/captions/srt';
import { subtitleFontFile } from '@/core/captions/style';
import type { Subtitles } from '../schemas/subtitles.schemas';

export interface SubtitleTextSource {
  path: string;
  label: string;
  font: string;
  text: unknown;
  options?: { upperCase?: boolean; lowerCase?: boolean };
}

interface LooseSection {
  name: string;
  options?: { upperCase?: boolean; lowerCase?: boolean };
  subtitles?: Subtitles;
}

function trackSources(section: LooseSection, subtitles: Subtitles, path: string): SubtitleTextSource[] {
  const dna = captionDna(subtitles.style);
  const font = subtitleFontFile(subtitles.font ?? dna.font);
  const upper = dna.case === 'upper' || dna.crown.case === 'upper';
  const options = { ...section.options, ...(upper && { upperCase: true, lowerCase: false }) };
  const label = `Section "${section.name}" subtitles`;

  function source(at: string, text: unknown): SubtitleTextSource {
    return { path: at, label, font, text, options };
  }

  const cues = (subtitles.cues ?? []).flatMap((cue, index) => [
    source(`${path}.cues[${index}].text`, cue.text),
    ...(cue.words ? [source(`${path}.cues[${index}].words`, cue.words.map((word) => word.text).join(' '))] : []),
  ]);
  const srt =
    subtitles.srt === undefined
      ? []
      : [
          source(
            `${path}.srt`,
            parseSrt(subtitles.srt)
              .cues.map((cue) => cue.text)
              .join(' ')
          ),
        ];
  const words = subtitles.words ? [source(`${path}.words`, subtitles.words.map((word) => word.text).join(' '))] : [];

  return [...cues, ...srt, ...words];
}

/** Every drawn subtitle string of the descriptor, with the font it draws in. */
export function subtitleSources(sections: readonly unknown[] | undefined): SubtitleTextSource[] {
  return (sections ?? []).flatMap((raw, index) => {
    const section = raw as LooseSection;

    return section.subtitles ? trackSources(section, section.subtitles, `sections[${index}].subtitles`) : [];
  });
}
