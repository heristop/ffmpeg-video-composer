import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { TITLE_EFFECT_ID, TITLE_EFFECT_VERSION } from '../effects/title-registry.js';
import type { McpConfig } from '../config.js';
import { getEffectDefinition, listEffectDefinitions } from '../effects/effect-catalog.js';

const inputSchema = z
  .object({ id: z.string().optional(), version: z.string().optional(), list: z.boolean().optional() })
  .strict()
  .refine(
    (value) => !value.list || (value.id === undefined && value.version === undefined),
    'list cannot be combined with id or version.'
  );
export function registerGetEffectSchema(server: McpServer, config: Pick<McpConfig, 'effectCatalog'> = {}): void {
  server.registerTool(
    'get_effect_schema',
    {
      title: 'Get Effect Schema',
      description:
        'Describe a trusted registered JSON effect, its prop defaults/bounds, local assets and runtime restrictions. Use list:true to discover builtin and operator-registered effects.',
      inputSchema,
    },
    (args: z.infer<typeof inputSchema>) => {
      try {
        const parsed = inputSchema.parse(args);

        if (parsed.list) {
          const catalog = {
            effects: listEffectDefinitions(config.effectCatalog).map((definition) => ({
              id: definition.id,
              version: definition.version,
              compositionId: definition.compositionId,
              description: definition.description,
              definitionHash: definition.definitionHash,
              output: definition.output,
            })),
          };

          return {
            content: [{ type: 'text' as const, text: JSON.stringify(catalog, null, 2) }],
            structuredContent: catalog,
          };
        }
        const definition = getEffectDefinition(
          parsed.id ?? TITLE_EFFECT_ID,
          parsed.version ?? TITLE_EFFECT_VERSION,
          config.effectCatalog
        );
        const schema = {
          id: definition.id,
          version: definition.version,
          compositionId: definition.compositionId,
          description: definition.description,
          definitionHash: definition.definitionHash,
          props: z.toJSONSchema(definition.props),
          assets: z.toJSONSchema(definition.assets),
          assetExtensions: definition.assetExtensions,
          assetVideoPolicies: definition.assetVideoPolicies,
          timing: definition.timing,
          runtime: {
            backend: 'Remotion/Chromium (Node MCP only)',
            requires:
              'allowRemotion + configured trusted remotionEntry + optional @remotion/bundler and @remotion/renderer peers',
            source:
              'No inline executable source or caller-selected entry. Configured source is trusted operator code, not sandboxed.',
          },
          output: definition.output,
          assetRestrictions: definition.assetRestrictions,
          geometry:
            'Remotion text fit and contrast are not measured by FFmpeg geometry validation; inspect render_preview.',
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(schema, null, 2) }],
          structuredContent: schema,
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                code: 'effect_schema_error',
                message: error instanceof Error ? error.message : String(error),
              }),
            },
          ],
        };
      }
    }
  );
}
