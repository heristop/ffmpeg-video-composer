import { z } from 'zod';
import { timeValue } from './time.schemas';

// Take editing on video / project_video sections: silence trimming, explicit keep windows and B-roll
// cutaways. Split from footage.schemas.ts for its line budget; its FOOTAGE_OPTION_FIELDS spreads these in.

export const TrimSilenceSchema = z
  .object({
    edges: z
      .boolean()
      .optional()
      .describe('Trim the silence before the first word and after the last one (default true).'),
    gaps: z
      .object({
        minSilence: z
          .number()
          .min(0.1)
          .max(10)
          .optional()
          .describe('Shortest pause in seconds that is cut, 0.1..10 (default 0.6); shorter pauses are kept.'),
        margin: z
          .number()
          .min(0)
          .max(2)
          .optional()
          .describe('Seconds of each pause kept next to the speech around it, 0..2 (default 0.15).'),
        threshold: z
          .number()
          .min(-90)
          .max(-10)
          .optional()
          .describe('Level in dBFS below which audio counts as silence, -90..-10 (default -35).'),
      })
      .strict()
      .optional()
      .describe('Also cut long pauses inside the take; {} enables it with the defaults.'),
  })
  .strict()
  .describe(
    'Cut silence out of a recorded take (Node: one silencedetect pass per clip). The section gets shorter, so ' +
      'its length is only known once the clip is analysed. Hosts without the analysis (browser, on-device) ' +
      'pass precomputed windows as options.keep instead.'
  );

export const KeepRangeSchema = z
  .tuple([
    z.number().min(0).describe('Window start, seconds into the source clip.'),
    z.number().positive().describe('Window end, seconds into the source clip (after the start).'),
  ])
  .describe('One kept window [from, to] of the source clip, in source seconds.');

export const KeepRangesSchema = z
  .array(KeepRangeSchema)
  .min(1)
  .max(200)
  .describe(
    'Source windows to keep, ascending and non-overlapping, e.g. [[0.4, 3.2], [4.1, 9.8]]: the clip is cut to ' +
      'these pieces back to back (trim/atrim + concat, every backend). The explicit form of trimSilence.'
  );

export const CutawaySchema = z
  .object({
    url: z.string().min(1).describe('URL or assets-relative path of the B-roll clip.'),
    at: timeValue(z.number().min(0)).describe(
      'When the cutaway starts, in section seconds (after any trimming) or a time reference ("50%", "cue:demo").'
    ),
    duration: z.number().positive().describe('How long the cutaway covers the main footage, in seconds.'),
    from: z.number().min(0).optional().describe('Seconds into the B-roll clip to start from (default 0).'),
    audio: z
      .enum(['a', 'b', 'mix'])
      .optional()
      .describe(
        'Sound during the cutaway: a = keep the main audio (default, e.g. voice-over on B-roll), b = switch to the ' +
          "cutaway's own audio, mix = both. b/mix need a cutaway clip with an audio track."
      ),
    fit: z
      .enum(['cover', 'contain'])
      .optional()
      .describe('Frame the B-roll: cover = fill and crop (default), contain = whole clip with bars.'),
  })
  .strict()
  .describe('A B-roll clip shown over the main footage for a window while the main timeline keeps running.');

export const CutawaysSchema = z
  .array(CutawaySchema)
  .max(32)
  .describe(
    'B-roll cutaways over this section, ascending by `at` and non-overlapping. The main clip keeps playing ' +
      'underneath (its audio too, unless audio is b).'
  );
