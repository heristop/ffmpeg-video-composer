import { z } from 'zod';

// The per-type fields of the designed transitions that draw bands (`count` / `angle` / `colors` /
// `stagger`), spread into TransitionSchema. Split out of effects.schemas.ts for its line budget.

export const TRANSITION_DESIGN_FIELDS = {
  count: z.number().int().min(2).max(8).optional().describe('bands: how many bands (default 4).'),
  angle: z
    .number()
    .min(-80)
    .max(80)
    .optional()
    .describe('bands: the bands’ angle in degrees, counter-clockwise from horizontal (default 30).'),
  colors: z
    .array(z.string())
    .min(1)
    .max(8)
    .optional()
    .describe('bands: band colours, cycled ("#rrggbb" or "$color.*"; default brand, accent, accent2, fg).'),
  stagger: z
    .number()
    .min(0)
    .max(0.5)
    .optional()
    .describe('bands: seconds between two bands (default 0.06, capped to fit the transition).'),
};

const TransitionDesignSchema = z.object(TRANSITION_DESIGN_FIELDS);

/** The bands fields of a designed transition. */
export type TransitionDesign = z.infer<typeof TransitionDesignSchema>;
