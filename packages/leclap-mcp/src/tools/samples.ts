import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { getSample, listSamples, SAMPLE_BACKENDS, SAMPLE_CATEGORIES } from 'ffmpeg-video-composer/samples';
import { partialCatalog } from 'ffmpeg-video-composer';

const inputSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('A sample ID from the list: returns that sample with its self-contained template.'),
    category: z.enum(SAMPLE_CATEGORIES).optional(),
    backend: z.enum(SAMPLE_BACKENDS).optional(),
    query: z
      .string()
      .max(4000)
      .optional()
      .describe('Case-insensitive search over ID, title, description and creative direction.'),
  })
  .strict();
type SamplesArgs = z.infer<typeof inputSchema>;

function failure(error: unknown) {
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          code: 'sample_discovery_error',
          message: error instanceof Error ? error.message : String(error),
          hint: 'Call get_samples without `id` to discover IDs, then with `id` to inspect requirements before rendering.',
        }),
      },
    ],
  };
}

// One sample with its descriptor, plus what each embedded partial is for (jobs, useWhen/avoidWhen)
// and how a ref can re-time it.
function sampleResult(id: string) {
  const sample = getSample(id);
  const partials = partialCatalog(sample.template.partials ?? []);

  return partials.length > 0 ? { ...sample, partialCatalog: partials } : { ...sample };
}

function samplesResult(args: SamplesArgs) {
  const { id, ...filters } = inputSchema.parse(args);

  if (id !== undefined) return sampleResult(id);

  return { samples: listSamples(filters) };
}

export function registerSamples(server: McpServer): void {
  server.registerTool(
    'get_samples',
    {
      title: 'Get Samples',
      description:
        'Packaged showcase samples. Without `id`: list them with creative direction and required inputs, ' +
        "filtered by `category`, `backend` or `query`. With `id`: that sample's metadata and a self-contained " +
        'descriptor with referenced partials embedded (summarized in partialCatalog: jobs, useWhen/avoidWhen, ' +
        'envelope, sync points); supply your own media and required fields, inspect native/Remotion setup and ' +
        'operator catalog requirements, then validate and compose. Always available, including Remotion samples ' +
        'when execution is disabled. No media is downloaded or rendered.',
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    (args: SamplesArgs) => {
      try {
        const result = samplesResult(args);

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error) {
        return failure(error);
      }
    }
  );
}
