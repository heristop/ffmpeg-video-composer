import type { McpServer } from '@modelcontextprotocol/server';
import { createBuilderLink, TemplateLinkError, type BuilderLink } from 'ffmpeg-video-composer';
import { z } from 'zod';

// open_in_builder: hands a template to a person in the LeClap web builder. The whole descriptor travels,
// compressed, in the link's URL fragment (#t=…), which browsers never send to a server: nothing is uploaded,
// and the link opens on any machine with a browser. Pure: no file access, no network.

const inputSchema = z
  .object({
    template: z.record(z.string(), z.json()).describe('The template descriptor to open in the builder.'),
    baseUrl: z
      .url({ protocol: /^https?$/ })
      .max(2000)
      .optional()
      .describe(
        'Where the builder is served (default https://leclap.dev). Add a locale prefix such as ' +
          'https://leclap.dev/fr, or point at a local dev server such as http://localhost:5173.'
      ),
  })
  .strict();
type OpenArgs = z.infer<typeof inputSchema>;

/** The builder link for `input.template`; throws a TemplateLinkError (invalid_template, too_large, …). */
export async function openInBuilder(input: unknown): Promise<BuilderLink> {
  const args = inputSchema.parse(input);

  return createBuilderLink(args.template, { baseUrl: args.baseUrl });
}

function errorText(error: unknown): string {
  if (!(error instanceof TemplateLinkError)) return error instanceof Error ? error.message : String(error);

  const issues = error.issues.length > 0 ? `\n${error.issues.slice(0, 20).join('\n')}` : '';

  return `${error.code}: ${error.message}${issues}`;
}

export function registerOpenInBuilder(server: McpServer): void {
  server.registerTool(
    'open_in_builder',
    {
      title: 'Open in Builder',
      description:
        'Return a link that opens the template in the LeClap web builder for a person to review and edit. The ' +
        'template travels compressed in the URL fragment, which browsers never send to a server: nothing is ' +
        'uploaded. Returns url, length, mediaToRebind (local paths and uploads the browser cannot read; they open ' +
        'as empty slots the person fills again) and warnings (e.g. a link long enough for chat apps to truncate, or ' +
        'a baseUrl off leclap.dev, whose page can read the template in the fragment). ' +
        'Validate first; an invalid or oversized template is refused.',
      inputSchema,
    },
    async (args: OpenArgs) => {
      try {
        const link = await openInBuilder(args);

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(link) }],
          structuredContent: link as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: errorText(error) }] };
      }
    }
  );
}
