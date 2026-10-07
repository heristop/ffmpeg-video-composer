import { z } from 'zod';
import { TimeNameSchema, TimeRefSchema } from './time.schemas';

// A reusable section fragment expanded into a template via `{ type: "partial", ref }` before
// validation/compilation. `sections` are kept loose (`z.unknown()`) here — they are validated as real
// sections once inlined. Kept in its own module so the root descriptor schema stays under max-lines.

/** The rhetorical job a partial does in a video — what an agent picks it for. */
export const PARTIAL_JOBS = [
  'hook',
  'orient',
  'reveal',
  'emphasize',
  'prove',
  'compare',
  'bridge',
  'ask',
  'brand',
  'close',
] as const;

export const PARTIAL_JOB_DESCRIPTIONS: Record<(typeof PARTIAL_JOBS)[number], string> = {
  hook: 'stop the scroll in the first seconds',
  orient: 'tell the viewer where they are (title, chapter, speaker)',
  reveal: 'uncover a product, answer or result',
  emphasize: 'punch one word, number or claim',
  prove: 'back a claim with a stat, quote or demo',
  compare: 'set two options side by side (this or that, before/after)',
  bridge: 'carry the viewer from one idea to the next',
  ask: 'pose a question or call to action',
  brand: 'sign the video with the logo or identity',
  close: 'land the ending and release the viewer',
};

export const PartialEnvelopeSchema = z
  .object({
    in: z
      .number()
      .min(0)
      .max(600)
      .describe('Seconds of fixed intro motion from the partial start (entrances); never stretched.'),
    out: z
      .number()
      .min(0)
      .max(600)
      .describe('Seconds of fixed outro motion before the partial end (exits); never stretched, only shifted.'),
  })
  .strict()
  .describe(
    'The partial motion envelope: IN (the first `in` s) and OUT (the last `out` s) are fixed; only the hold between ' +
      'them stretches when a ref sets `duration`. Without it the whole partial counts as IN (the tail holds).'
  );

export const SyncPointSchema = z
  .object({
    id: TimeNameSchema.describe('Name of the moment; exported as the cue "cue:<id>" on the expanded section.'),
    offset: z
      .number()
      .min(0)
      .max(600)
      .describe('Seconds from the partial start, inside the IN envelope (e.g. when the logo lands).'),
  })
  .strict()
  .describe('A named moment of the partial a ref can `align` to the music or another cue.');

export const TemplatePartialSchema = z
  .object({
    id: z.string().describe('Stable id referenced by `{ type: "partial", ref }` sections.'),
    description: z.string().optional().describe('Short human-readable summary of the partial.'),
    variables: z.record(z.string(), z.string()).optional().describe('Default `{{ key }}` values, overridden per ref.'),
    sections: z.array(z.unknown()).describe('The real sections this partial expands into (validated once inlined).'),
    envelope: PartialEnvelopeSchema.optional(),
    syncPoints: z
      .array(SyncPointSchema)
      .max(16)
      .optional()
      .describe('Named moments (offset ≤ envelope.in) exported as section cues and targeted by a ref `align`.'),
    jobs: z
      .array(z.enum(PARTIAL_JOBS))
      .max(4)
      .optional()
      .describe(`Rhetorical purpose of the partial, for agents choosing one: ${PARTIAL_JOBS.join(', ')}.`),
    useWhen: z.string().max(400).optional().describe('One sentence: the situation this partial is right for.'),
    avoidWhen: z.string().max(400).optional().describe('One sentence: the situation where it reads wrong.'),
  })
  .superRefine((partial, ctx) => {
    const limit = partial.envelope?.in;

    for (const [index, point] of (partial.syncPoints ?? []).entries()) {
      if (limit !== undefined && point.offset > limit + 1e-9) {
        ctx.addIssue({
          code: 'custom',
          path: ['syncPoints', index, 'offset'],
          message: `sync point "${point.id}" at ${point.offset}s is after the IN envelope (${limit}s)`,
        });
      }
    }
  })
  .describe('A reusable section fragment expanded into a template via `{ type: "partial", ref }`.');

export const PartialAlignSchema = z
  .object({
    sync: TimeNameSchema.describe('Id of one of the partial `syncPoints`.'),
    to: z
      .union([z.number().min(0), TimeRefSchema])
      .describe(
        'Where the sync point must land, in whole-video time: seconds, "beat:9", "bar:3" (needs global.beats) or ' +
          '"cue:drop" (a cue of an EARLIER section), each with an optional offset.'
      ),
  })
  .strict()
  .describe(
    'Snap a sync point of the partial onto a beat or cue by lengthening/shortening the section right before the ref. ' +
      'Every section up to the target must have a known duration.'
  );

// Fields of the `{ type: "partial", ref }` section (spread into PartialSectionSchema).
export const PARTIAL_REF_TIMING_FIELDS = {
  duration: z
    .number()
    .positive()
    .max(3600)
    .optional()
    .describe(
      'Total seconds for this use of the partial. Only the hold between envelope IN and OUT stretches: IN keeps ' +
        'its times, OUT (exits) shifts by the extra. Shorter than IN + OUT compresses both (partial_compressed).'
    ),
  align: PartialAlignSchema.optional(),
};

export const PartialRefTimingSchema = z.object(PARTIAL_REF_TIMING_FIELDS);

export type PartialEnvelope = z.infer<typeof PartialEnvelopeSchema>;
export type SyncPoint = z.infer<typeof SyncPointSchema>;
export type PartialAlign = z.infer<typeof PartialAlignSchema>;
export type PartialJob = (typeof PARTIAL_JOBS)[number];
