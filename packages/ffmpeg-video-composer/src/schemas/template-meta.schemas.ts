import { z } from 'zod';
import { META_INTENT_FIELDS } from './section-intent.schemas';
import { ResolvedRecordsSchema } from './transcribe.schemas';

// The descriptor's `meta` block: human-facing metadata plus the authoring intent (brief, purpose rule).
export const TemplateMetaSchema = z
  .object({
    name: z.string().optional().describe('Human-readable template name for catalogs and editors.'),
    description: z.string().optional().describe('Short human-readable template summary for catalogs and agents.'),
    creativeDirection: z
      .string()
      .trim()
      .min(1)
      .max(4000)
      .optional()
      .describe(
        'Authoring brief (1..4000 characters): audience, visual hierarchy, typography, palette, motion, pacing, ' +
          'avoidances and review criteria. Guides humans/agents; never interpreted or executed by the renderer. ' +
          'Implement the direction explicitly in sections, filters and effect props.'
      ),
    ...META_INTENT_FIELDS,
    resolved: ResolvedRecordsSchema.optional(),
  })
  .strict()
  .describe('Optional human-facing metadata embedded in the descriptor; behavioral catalog fields are derived.');
