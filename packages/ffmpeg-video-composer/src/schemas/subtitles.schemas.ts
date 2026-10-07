import { z } from 'zod';
import { TranslationSchema } from './global.schemas';
import { timeValue } from './time.schemas';
import { CAPTION_DNA_IDS } from '../core/captions/dna';
import { CAPTION_POSITIONS } from './text.schemas';

// ── subtitles: word-timed captions ─────────────────────────────────────────────────
//
// A subtitle track for one section: cues authored inline, an SRT document, or raw word timings from a
// speech-to-text pass. The engine groups words into readable phrases, fits and balances each phrase on
// at most `maxLines` lines, and draws it in a caption identity ("DNA") with optional karaoke. Lowered
// to deterministic drawtext / drawbox filters with enable windows (editor/presets/subtitles.ts).

export const SUBTITLE_KARAOKE = ['word', 'fill', 'pop'] as const;

export const WordTimingSchema = z
  .object({
    text: z.string().min(1).describe('The word as spoken, with its punctuation ("world," / "done.").'),
    start: z.number().min(0).describe('When the word starts, in seconds from the section start.'),
    end: z.number().min(0).describe('When the word ends, in seconds from the section start.'),
  })
  .strict()
  .describe('One word with its timing, e.g. from speech-to-text.');

export type WordTimingInput = z.infer<typeof WordTimingSchema>;

const WordsSchema = z.array(WordTimingSchema).max(5000);

export const SubtitleCueSchema = z
  .object({
    at: timeValue(z.number().min(0)).describe(
      'When the cue appears: seconds from the section start or a time reference ("title.end").'
    ),
    end: timeValue(z.number().min(0)).describe('When the cue disappears: seconds or a time reference.'),
    text: z
      .union([TranslationSchema, z.string()])
      .describe('The cue text: a string or a per-locale map. Re-wrapped to the frame; line breaks are ignored.'),
    words: WordsSchema.optional().describe(
      'Word timings inside this cue (seconds from the section start) for karaoke. Default: the section `words` ' +
        'falling inside the cue, else the cue window shared by character count.'
    ),
  })
  .strict()
  .describe('One authored subtitle cue.');

export const SubtitleGroupSchema = z
  .object({
    maxWords: z.number().int().min(1).max(20).optional().describe('Most words per caption group (default 6).'),
    maxSeconds: z
      .number()
      .min(0.5)
      .max(10)
      .optional()
      .describe('Longest a group may run, first word start to last word end (default 2.5 s).'),
    pause: z
      .number()
      .min(0)
      .max(5)
      .optional()
      .describe('A silence at least this long between words starts a new group (default 0.5 s).'),
    commaPause: z
      .number()
      .min(0)
      .max(5)
      .optional()
      .describe('After a comma / semicolon / colon, a silence this long starts a new group (default 0.25 s).'),
    minSeconds: z
      .number()
      .min(0)
      .max(5)
      .optional()
      .describe('A group cut by maxWords / maxSeconds that is spoken faster than this merges forward (default 0.5 s).'),
    lead: z.number().min(0).max(1).optional().describe('Seconds a group appears before its first word (default 0.08).'),
    linger: z
      .number()
      .min(0)
      .max(3)
      .optional()
      .describe('Seconds a group stays after its last word, never into the next group (default 0.6).'),
  })
  .strict()
  .describe('How word timings are grouped into caption phrases.');

export const SubtitlesSchema = z
  .object({
    cues: z.array(SubtitleCueSchema).max(2000).optional().describe('Authored cues, in time order.'),
    srt: z
      .string()
      .max(500_000)
      .optional()
      .describe('An inline SRT (or WebVTT) document; times are seconds from the section start.'),
    words: WordsSchema.optional().describe(
      'Word timings for the whole section (speech-to-text output). Alone, they are grouped into cues by `group`; ' +
        'with `cues` / `srt`, they time the karaoke inside each cue.'
    ),
    timing: z
      .enum(['words', 'even'])
      .optional()
      .describe(
        'Karaoke timing: "words" uses word timings when present; "even" shares each cue by character count (default words when present, else even).'
      ),
    group: SubtitleGroupSchema.optional(),
    style: z
      .enum(CAPTION_DNA_IDS)
      .optional()
      .describe(
        'Caption DNA (identity): clean (default), loud, keynote, documentary, boxed, neon. See motionCatalog().captions.'
      ),
    karaoke: z
      .union([z.literal(false), z.enum(SUBTITLE_KARAOKE)])
      .optional()
      .describe(
        'false: plain captions. word: the spoken word is redrawn in the active colour. fill: words turn active as ' +
          'spoken and stay. pop: the spoken word bumps in scale. Default: the DNA choice.'
      ),
    position: z.enum(CAPTION_POSITIONS).optional().describe('Vertical placement (default per DNA).'),
    size: z.number().min(8).max(400).optional().describe('Font size in px (default per DNA, from the frame size).'),
    minSize: z
      .number()
      .min(8)
      .max(400)
      .optional()
      .describe('Smallest size a long cue may shrink to before it is split (default 75% of size).'),
    maxLines: z.number().int().min(1).max(4).optional().describe('Most lines per cue on screen (default 2).'),
    minDuration: z
      .number()
      .min(0)
      .max(10)
      .optional()
      .describe('Shortest time a cue stays on screen, extended without overlapping the next (default 1 s).'),
    offset: z
      .number()
      .min(-600)
      .max(600)
      .optional()
      .describe('Seconds added to every time (re-sync an SRT or transcript to the cut).'),
    crown: z
      .string()
      .min(1)
      .max(120)
      .optional()
      .describe(
        'The one payoff line drawn larger in the crown colour: "auto" (the last exclaimed or final cue) or a phrase ' +
          'contained in that cue. Use once per video.'
      ),
    font: z.string().optional().describe('Bundled font id overriding the DNA font (must be bundled for layout).'),
    color: z.string().optional().describe('Base text colour overriding the DNA (hex or $color.* token).'),
    activeColor: z.string().optional().describe('Active-word colour overriding the DNA (hex or $color.* token).'),
  })
  .strict()
  .refine((value) => value.cues !== undefined || value.srt !== undefined || value.words !== undefined, {
    message: 'subtitles need cues, srt or words',
  })
  .refine((value) => value.cues === undefined || value.srt === undefined, {
    message: 'use either cues or srt, not both',
  })
  .describe(
    'Word-timed captions for this section: cues, an SRT document or speech-to-text word timings, grouped, ' +
      'fitted to at most maxLines balanced lines and drawn in a caption DNA with optional karaoke.'
  )
  .meta({ id: 'Subtitles' });

export type Subtitles = z.infer<typeof SubtitlesSchema>;
export type SubtitleCue = z.infer<typeof SubtitleCueSchema>;
