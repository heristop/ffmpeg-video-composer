import { z } from 'zod';

// ── motion assertions ────────────────────────────────────────────────────────────
//
// Section-level checks an agent writes next to its choreography and the validator proves against the
// motion timeline, render-free: "the headline is readable by 1.2 s", "the kicker lands before the
// headline starts". A failing assertion is a validation error (`assertion_failed`) naming the target and
// the measured value.

const TargetSchema = z
  .string()
  .min(1)
  .describe(
    'An element of this section: its `id`, or its path — "kinetic[0]", "graphics[1]", "filters[2]", ' +
      '"titleCard", "lowerThird", "caption".'
  );

export const AssertionSchema = z
  .union([
    z
      .object({
        visibleBy: z
          .object({
            target: TargetSchema,
            at: z.number().min(0).describe('Section-local seconds by which the entrance must have completed.'),
          })
          .strict(),
      })
      .strict()
      .describe('The target has fully entered by `at` seconds.'),
    z
      .object({
        before: z.tuple([TargetSchema, TargetSchema]).describe('[a, b]: a finishes entering before b starts entering.'),
      })
      .strict()
      .describe('Sequencing: the first target lands before the second one starts.'),
    z
      .object({ inFrame: TargetSchema })
      .strict()
      .describe('The target rests entirely inside the frame (skipped when its box is not measurable).'),
    z
      .object({
        keepsMoving: z
          .object({
            maxStill: z
              .number()
              .positive()
              .max(60)
              .describe('Longest allowed stretch, in seconds, with nothing moving.'),
          })
          .strict(),
      })
      .strict()
      .describe('The section is never still for longer than `maxStill` seconds.'),
  ])
  .meta({ id: 'MotionAssertion' });

export const AssertionsSchema = z
  .array(AssertionSchema)
  .max(16)
  .describe('Motion assertions proven against the timeline at validation; a failure is an assertion_failed error.');

export type MotionAssertion = z.infer<typeof AssertionSchema>;
