import { z } from 'zod';

// Authoring intent: why a section exists (`purpose`) and its narrative role, plus the template-level
// switches that ask for them. Metadata only: never rendered, never lowered. Spread into the section base
// and the template meta so every section type accepts them.

/**
 * Narrative roles: the motion catalog blueprint roles (core/motion/catalog-blueprints.ts) plus reveal and
 * bridge, so a blueprint dropped into a template keeps a valid role (tests/motion-roles-lint.test.ts pins it).
 */
export const SECTION_ROLES = ['hook', 'problem', 'product-intro', 'reveal', 'proof', 'cta', 'outro', 'bridge'] as const;

export type SectionRole = (typeof SECTION_ROLES)[number];

export const SECTION_INTENT_FIELDS = {
  purpose: z
    .string()
    .trim()
    .min(1)
    .max(400)
    .optional()
    .describe(
      'Why this section exists, in one sentence (what the viewer should think or feel when it ends). ' +
        'Authoring metadata for humans and agents; never rendered.'
    ),
  role: z
    .enum(SECTION_ROLES)
    .optional()
    .describe(
      'Narrative role of the section: hook, problem, product-intro, reveal, proof, cta, outro or bridge. ' +
        'Matches the motion catalog blueprint roles; never rendered.'
    ),
};

export const META_INTENT_FIELDS = {
  brief: z
    .string()
    .trim()
    .min(1)
    .max(4000)
    .optional()
    .describe(
      'The production brief this template answers (a one-liner or a path such as "brief.md"). Setting it ' +
        'opts the template into the section_without_purpose advisory. Never rendered.'
    ),
  requirePurpose: z
    .boolean()
    .optional()
    .describe('When true, every rendering section should declare a `purpose` (advisory section_without_purpose).'),
};
