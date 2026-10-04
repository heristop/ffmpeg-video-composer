import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { getSample, listSamples, SAMPLE_BACKENDS, SAMPLE_CATEGORIES } from 'ffmpeg-video-composer/samples';

const listInput = z
  .object({
    category: z.enum(SAMPLE_CATEGORIES).optional(),
    backend: z.enum(SAMPLE_BACKENDS).optional(),
    query: z
      .string()
      .max(4000)
      .optional()
      .describe('Case-insensitive search over ID, title, description and creative direction.'),
  })
  .strict();
const getInput = z.object({ id: z.string().min(1).max(200).describe('Stable sample ID from list_samples.') }).strict();

function failure(error: unknown) {
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          code: 'sample_discovery_error',
          message: error instanceof Error ? error.message : String(error),
          hint: 'Use list_samples to discover IDs and get_sample to inspect requirements before rendering.',
        }),
      },
    ],
  };
}

export function registerSamples(server: McpServer): void {
  server.registerTool(
    'list_samples',
    {
      title: 'List Samples',
      description:
        'Discover packaged showcase samples, creative direction and required inputs. Always available, including Remotion samples when execution is disabled. No media is downloaded or rendered.',
      inputSchema: listInput,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    (args: z.infer<typeof listInput>) => {
      try {
        const result = { samples: listSamples(listInput.parse(args)) };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error) {
        return failure(error);
      }
    }
  );
  server.registerTool(
    'get_sample',
    {
      title: 'Get Sample',
      description:
        'Retrieve sample metadata and a self-contained descriptor with referenced partials embedded. Supply your own media and required fields; inspect native/Remotion setup and operator catalog requirements, then validate and compose. No effect execution or bundled preview media.',
      inputSchema: getInput,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    (args: z.infer<typeof getInput>) => {
      try {
        const result = { ...getSample(getInput.parse(args).id) };

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
