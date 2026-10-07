// What an agent reads about word-timed captions in the motion catalog: the DNA identities, the karaoke
// modes, the fields and the house rules.

import { captionDnaCatalog, type CaptionDna, type CaptionDnaId } from './dna';
import { DEFAULT_GROUP_RULES, type GroupRules } from './grouping';

export interface CaptionCatalog {
  styles: Array<{ id: CaptionDnaId } & CaptionDna>;
  karaoke: Record<'false' | 'word' | 'fill' | 'pop', string>;
  group: GroupRules;
  fields: string[];
  rules: string[];
  advisories: string[];
  errors: string[];
}

export function captionCatalog(): CaptionCatalog {
  return {
    styles: captionDnaCatalog(),
    karaoke: {
      false: 'Plain captions: each line drawn once.',
      word: 'The spoken word is redrawn in the active colour (and the DNA active scale) while it is spoken.',
      fill: 'Words wait in the base colour and turn active as they are spoken, staying lit until the cue leaves.',
      pop: 'Like word, plus an eased scale bump as each word starts.',
    },
    group: DEFAULT_GROUP_RULES,
    fields: [
      'subtitles.words[] { text, start, end } (speech-to-text, section seconds)',
      'subtitles.cues[] { at, end, text, words? } (at/end accept time references)',
      'subtitles.srt (inline SRT / WebVTT text)',
      'subtitles.timing (words | even)',
      'subtitles.group { maxWords, maxSeconds, pause, commaPause, minSeconds, lead, linger }',
      'subtitles.style (DNA id)',
      'subtitles.karaoke (false | word | fill | pop)',
      'subtitles.position / size / minSize / maxLines / minDuration / offset',
      'subtitles.crown ("auto" or a phrase)',
      'subtitles.font / color / activeColor (overrides; colours accept $color.* tokens)',
      'caption.wrap (greedy | balanced) and caption.fit { minSize, maxLines }',
      'kinetic[].wrap (greedy | balanced)',
    ],
    rules: [
      'Prefer real word timings (speech-to-text) over even timing: karaoke on guessed timing drifts from the voice.',
      'One DNA per video; change it only to mark a change of voice (narrator vs. quote).',
      'Two lines at most on screen; let the engine shrink, rebalance and split rather than shortening copy by hand.',
      'Crown one payoff line per video ("auto" picks the last exclaimed or final cue of the section).',
      'Set global.platform so captions clear the app UI on vertical platforms.',
    ],
    advisories: ['caption_split', 'caption_shrunk', 'subtitle_past_end', 'caption_crown_repeated'],
    errors: ['invalid_srt', 'invalid_word_timings', 'invalid_subtitle_cue', 'subtitle_font_unmeasurable'],
  };
}
