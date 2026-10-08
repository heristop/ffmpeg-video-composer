// Reference material, each loaded on its first call (none of it ships with the builder): the template
// JSON Schema with a builder guide (#3 get_template_schema), the motion catalog with ranked search
// (#4 get_motion_catalog), and the packaged samples (#5 list_samples, #6 get_sample). The schema and
// catalog match @leclap/mcp so an agent can move between the two surfaces; the sample pair is browser-only
// (@leclap/mcp has one get_samples).
import { z } from 'zod';
import { SAMPLE_BACKENDS, SAMPLE_CATEGORIES } from 'ffmpeg-video-composer/src/samples/types.ts';
import { parsePointer } from 'ffmpeg-video-composer/src/core/json-patch.ts';
import { MAX_STRING } from './guard';
import { capOutput, fail, ok } from './results';
import { openable } from './sample-loader';
import { defineTool } from './types';

/** How the builder differs from a raw descriptor, prepended to the schema. */
export const BUILDER_GUIDE = [
  'Builder guide (WebMCP): you are editing the template open in the LeClap builder, not a file.',
  'Every edit tool takes expectedRevision (from get_template / list_sections) and is one undo step for the user.',
  'The builder cannot hold registered "effect" sections. Partial sections must reference an id from ' +
    'get_template.availablePartials. Section names are assigned by the builder (<kind>_<n>); a name you set is replaced.',
  'Music is not a section in the descriptor: it lives in global.musicEnabled / allowedMusic / allowUploadMusic.',
  'media:// refs are opaque user uploads; reuse the ones already in the template and never invent new ones. ' +
    'Images and clips may also be library ids or same-origin paths; blob:, data: and foreign URLs are refused.',
  'Fields the builder has no place for are dropped on apply and reported in `dropped`; an edit that only touches ' +
    'such fields fails with no_effect. Prefer the structured fields (titleCard, overlays as drawtext filters, look, ' +
    'grade, transition, motion) over raw filters.',
  'Compose motion, do not pick it: derive a motion intent per section from the creative direction, build it from ' +
    'kinetic, animate tracks, camera, transitions, graphics and fx primitives (get_motion_catalog), tune their ' +
    'parameters, and keep one or two signature moves. Library animation overlays are samples, a last resort.',
  'Validate with validate_template before large edits. Rendering and saving are done by the user in the page.',
].join('\n');

function walk(schema: unknown, pointer: string): unknown {
  let current = schema;

  for (const segment of parsePointer(pointer)) {
    if (!current || typeof current !== 'object') return undefined;

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

type Loose = Record<string, unknown>;

function asRecord(value: unknown): Loose {
  return value && typeof value === 'object' ? (value as Loose) : {};
}

function sectionVariantType(variant: unknown): string {
  const type = asRecord(asRecord(asRecord(variant).properties).type);

  if (typeof type.const === 'string') return type.const;

  return Array.isArray(type.enum) ? type.enum.join('|') : 'section';
}

/** Where to look in a schema too large to return whole: its top-level parts and each section type. */
export function schemaIndex(schema: unknown): Array<{ pointer: string; about: string; bytes: number }> {
  const root = asRecord(schema);
  const entry = (pointer: string, about: string, value: unknown) => ({
    pointer,
    about,
    bytes: JSON.stringify(value).length,
  });
  const parts = Object.entries(asRecord(root.properties)).map(([key, value]) =>
    entry(
      `/properties/${key}`,
      typeof asRecord(value).description === 'string' ? String(asRecord(value).description) : key,
      value
    )
  );
  const variants = asRecord(asRecord(asRecord(root.properties).sections).items).oneOf;
  const sections = (Array.isArray(variants) ? variants : []).map((variant, i) =>
    entry(`/properties/sections/items/oneOf/${String(i)}`, `section type ${sectionVariantType(variant)}`, variant)
  );
  const defs = Object.entries(asRecord(root.$defs)).map(([key, value]) => entry(`/$defs/${key}`, key, value));

  return [...parts, ...sections, ...defs];
}

function schemaText(part: unknown, pointer: string | undefined): string {
  const json = JSON.stringify(part);

  if (pointer !== undefined || json.length <= 150_000) return `${BUILDER_GUIDE}\n\nJSON Schema:\n${json}`;

  const index = JSON.stringify(schemaIndex(part), null, 1);

  return `${BUILDER_GUIDE}\n\nThe whole schema is too large to return at once; call again with one of these pointers:\n${index}`;
}

const getTemplateSchema = defineTool({
  name: 'get_template_schema',
  title: 'Get Template Schema',
  description:
    'Return the builder guide and the template descriptor JSON Schema (the authoritative shape for edit_template). ' +
    'Without `pointer` the schema is too large, so you get an index of pointers (top-level parts, one per section ' +
    'type) to call again with, e.g. "/properties/global".',
  kind: 'read',
  input: z.object({
    pointer: z.string().max(500).optional().describe('JSON Pointer into the schema; omit for the whole schema.'),
  }),
  run: async (args) => {
    const { templateDescriptorJsonSchema } = await import('ffmpeg-video-composer/src/schemas/template.schemas.ts');
    let part: unknown = templateDescriptorJsonSchema;

    try {
      part = args.pointer ? walk(templateDescriptorJsonSchema, args.pointer) : part;
    } catch (error) {
      return fail('invalid_input', error instanceof Error ? error.message : 'Invalid pointer.');
    }

    if (part === undefined) return fail('not_found', `Nothing at ${String(args.pointer)} in the schema.`);

    const result = { content: [{ type: 'text' as const, text: schemaText(part, args.pointer) }] };

    return capOutput(result, 'Pass a pointer such as "/properties/sections" or "/$defs/<name>".');
  },
});

const getMotionCatalog = defineTool({
  name: 'get_motion_catalog',
  title: 'Get Motion Catalog',
  description:
    'Return the motion catalog: kinetic typography presets, exits, easing grammar, motion tokens, built-in themes, ' +
    'art-direction rules, genre doctrine, scene blueprints, fx primitives and a starter — or, with `query` (and ' +
    'optionally `kind`), the ranked matches only, engine primitives first. Call it before authoring animated copy, ' +
    'camera moves, graphics or designed transitions: compose motion from these primitives, tuned to the brief. ' +
    'Library animations appear only as `samples` (stock demo overlays, a last resort).',
  kind: 'read',
  input: z.object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe('A plain-language need ("one punch word on the beat"). Returns ranked matches instead of everything.'),
    kind: z
      .string()
      .max(40)
      .optional()
      .describe(
        'Limit a query to one part: kinetic, camera, graphic, fx, transition, blueprint, doctrine, theme, platform, ' +
          'easing, sample…'
      ),
  }),
  run: async (args) => {
    const [{ motionCatalog }, { CATALOG_KINDS, searchMotionCatalog }] = await Promise.all([
      import('ffmpeg-video-composer/src/core/motion/catalog.ts'),
      import('ffmpeg-video-composer/src/core/motion/catalog-search.ts'),
    ]);
    const kind = CATALOG_KINDS.find((known) => known === args.kind);

    if (args.kind !== undefined && !kind) {
      return fail('invalid_input', `Unknown kind; use one of: ${CATALOG_KINDS.join(', ')}.`);
    }

    const payload = args.query === undefined ? motionCatalog() : searchMotionCatalog(args.query, { kind });

    return capOutput(
      { content: [{ type: 'text', text: JSON.stringify(payload) }] },
      'Pass a query (and kind) for ranked matches instead of the whole catalog.'
    );
  },
});

const listSamplesTool = defineTool({
  name: 'list_samples',
  title: 'List Samples',
  description:
    'Discover the packaged showcase samples: id, title, description, creative direction and required inputs. ' +
    '`openable` marks the ones the builder can hold (native backend, no effect sections). Nothing is rendered.',
  kind: 'read',
  input: z.object({
    category: z.enum(SAMPLE_CATEGORIES).optional(),
    backend: z.enum(SAMPLE_BACKENDS).optional(),
    query: z
      .string()
      .max(MAX_STRING)
      .optional()
      .describe('Case-insensitive search over id, title, description and direction.'),
  }),
  run: async (args) => {
    const { listSamples } = await import('ffmpeg-video-composer/src/samples.ts');
    const samples = listSamples(args).map((sample) => ({
      ...sample,
      openable: openable(sample),
    }));

    return capOutput(ok({ samples }, `${String(samples.length)} sample(s).`), 'Filter by category, backend or query.');
  },
});

const getSampleTool = defineTool({
  name: 'get_sample',
  title: 'Get Sample',
  description:
    'Retrieve one sample: metadata plus a self-contained descriptor (referenced partials embedded, summarized in ' +
    'partialCatalog). Use it as a model for your own edits, or open it in place of the draft with load_sample.',
  kind: 'read',
  input: z.object({ id: z.string().min(1).max(200).describe('Sample id from list_samples.') }),
  run: async (args) => {
    const [{ getSample }, { partialCatalog }] = await Promise.all([
      import('ffmpeg-video-composer/src/samples.ts'),
      import('ffmpeg-video-composer/src/core/motion/catalog-partials.ts'),
    ]);

    try {
      const sample = getSample(args.id);
      const partials = partialCatalog(sample.template.partials ?? []);
      const result = partials.length > 0 ? { ...sample, partialCatalog: partials } : { ...sample };

      return capOutput(ok(result, `Sample ${sample.id}.`), 'This sample is too large to return.');
    } catch (error) {
      return fail('not_found', error instanceof Error ? error.message : String(error), {
        hint: 'Use list_samples to discover ids.',
      });
    }
  },
});

export const REFERENCE_TOOLS = [getTemplateSchema, getMotionCatalog, listSamplesTool, getSampleTool];
