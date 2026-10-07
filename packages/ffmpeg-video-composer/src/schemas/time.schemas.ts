import { z } from 'zod';
import { TIME_NAME, TIME_NAME_MAX, timeRefError } from '../core/timing/grammar';

// ── time references (section-local anchors, resolved at compile time) ─────────────
//
// Any "when" field inside a section (kinetic delay, graphic at/until, camera hits, keyframe t, drawtext
// reveal delay / exit after) takes seconds OR a reference, so a template names the moment instead of
// doing the arithmetic. References resolve to plain seconds before lowering (core/timing/resolve.ts).

export const TIME_REF_DESCRIPTION =
  'A moment in this section, resolved to seconds at compile time. "<id>.start" / "<id>.end": an element ' +
  'with that id in the same section (kinetic block, graphic or drawtext filter); end = when its entrance ' +
  'has landed. "50%": a fraction of the section duration. "end": the section end. "beat:12" / "bar:3": ' +
  'the 12th beat / downbeat of bar 3 of global.beats (1-based, counted on the whole video). "cue:drop": ' +
  'a named point in sections[].cues. Every form takes an offset in seconds: "title.end + 0.2", ' +
  '"end - 0.5", "beat:8 - 0.1". Hits and flashes land exactly on a beat; lead entrances by 0.04–0.19 s ' +
  '("beat:8 - 0.1") so they read as on the beat.';

const NAME_MESSAGE =
  'names start with a letter and use letters, digits, "_" and "-" (a "-" must be followed by a letter)';

export const TimeNameSchema = z.string().max(TIME_NAME_MAX).regex(TIME_NAME, NAME_MESSAGE);

export const TimeRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .superRefine((text, ctx) => {
    const issue = timeRefError(text);

    if (issue) ctx.addIssue({ code: 'custom', message: issue });
  })
  .describe(TIME_REF_DESCRIPTION)
  .meta({ id: 'TimeRef' });

/** Seconds (bounded by `seconds`) or a time reference. */
export function timeValue<T extends z.ZodType<number>>(seconds: T) {
  return z.union([seconds, TimeRefSchema]);
}

export const ElementIdSchema = TimeNameSchema.describe(
  'Id other time fields in this section reference as "<id>.start" / "<id>.end". Unique within the section.'
);

const BeatsPerBarSchema = z.number().int().min(1).max(16).optional().describe('Beats per bar (default 4).');

// What an analysis (`leclap beats`, the analyze_music MCP tool, or the Node compile) reports with its grid.
const AnalysisMarks = {
  confidence: z
    .number()
    .min(0)
    .optional()
    .describe('Confidence of an analysed grid: z-score of its tempo peak; 3 or more is a clear pulse.'),
  usable: z
    .boolean()
    .optional()
    .describe(
      'From an analysis: false when the music has no reliable pulse (calm, ambient). Validation then warns ' +
        'beat_grid_low_confidence: pace such a track by phrases and section lengths, not beats.'
    ),
};

export const BeatsSchema = z
  .union([
    z
      .object({
        bpm: z.number().min(20).max(400).describe('Tempo in beats per minute.'),
        offset: z.number().min(0).optional().describe('Video time of beat 1 in seconds (default 0).'),
        beatsPerBar: BeatsPerBarSchema,
        ...AnalysisMarks,
      })
      .strict(),
    z
      .object({
        times: z
          .array(z.number().min(0))
          .min(1)
          .max(4096)
          .refine((times) => times.every((time, i) => i === 0 || time > times[i - 1]), 'beat times must ascend')
          .describe('Beat times in video seconds, ascending (from an analysis of the music).'),
        beatsPerBar: BeatsPerBarSchema,
        ...AnalysisMarks,
      })
      .strict(),
    z
      .object({
        analyze: z
          .literal('music')
          .describe(
            'Measure the grid from the template music track at compile time (Node only; the browser and ' +
              'on-device engines report beats_analysis_unavailable: precompute with `leclap beats` or analyze_music).'
          ),
        beatsPerBar: BeatsPerBarSchema,
      })
      .strict(),
  ])
  .describe(
    'The beat grid of the whole video, for "beat:n" / "bar:n" time references and section lengths in beats: ' +
      '{ bpm, offset?, beatsPerBar? }, explicit { times } from a music analysis, or { analyze: "music" } to ' +
      'measure the music track when compiling on Node. Beats are 1-based and counted from the start of the video.'
  )
  .meta({ id: 'Beats' });

export const BeatDurationSchema = z
  .union([
    z.object({ beats: z.number().positive().describe('Section length in beats of global.beats.') }).strict(),
    z.object({ bars: z.number().positive().describe('Section length in bars of global.beats.') }).strict(),
  ])
  .describe(
    'A section length counted on the beat grid: { beats: 8 } or { bars: 2 }. Needs global.beats with a bpm ' +
      '(or { analyze: "music" } on Node); resolved to seconds before any time reference.'
  )
  .meta({ id: 'BeatDuration' });

export const CuesSchema = z
  .record(TimeNameSchema, z.number().min(0))
  .describe('Named moments in this section, in seconds from its start, referenced as "cue:<name>".');

export type TimeRefValue = number | string;
export type BeatsInput = z.infer<typeof BeatsSchema>;
