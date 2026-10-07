import type { McpServer } from '@modelcontextprotocol/server';
import { CATALOG_KINDS, motionCatalog, searchMotionCatalog } from 'ffmpeg-video-composer';
import { z } from 'zod';

// The motion catalog (kinetic typography presets, exits, orders, easing grammar, built-in tokens,
// built-in themes, art-direction rules, genre doctrine, scene blueprints and a complete starter beat)
// straight from the engine, so an agent can design "wow" motion without reading source, and every
// name it picks is one the renderer accepts. With a `query`, only the ranked matches come back.

const inputSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'A plain-language need ("one punch word on the beat", "calm instructions", "reveal a product"). Returns ' +
        'ranked matches instead of the whole catalog.'
    ),
  kind: z.enum(CATALOG_KINDS).optional().describe('Limit a query to one part of the catalog.'),
});

type CatalogArgs = z.infer<typeof inputSchema>;

/** The whole catalog, or the ranked matches for a query (with a `gap` pointer when there are none). */
export function catalogResponse(args: CatalogArgs): unknown {
  if (args.query === undefined) return motionCatalog();

  const search = searchMotionCatalog(args.query, { kind: args.kind });

  if (search.matches.length > 0) return search;

  return { ...search, gap: { query: args.query, hint: 'call report_catalog_gap' } };
}

export function registerGetMotionCatalog(server: McpServer): void {
  server.registerTool(
    'get_motion_catalog',
    {
      title: 'Get Motion Catalog',
      description:
        'Return the motion catalog: kinetic typography presets with their defaults, exit presets, ' +
        'stagger orders, the easing grammar (springs, cubic-bezier, named curves), built-in motion tokens, ' +
        'built-in themes (palette, fonts and motion feel for global.theme, referenced as $color.* / $font.*), ' +
        'caption DNA identities and karaoke modes for word-timed subtitles, ' +
        'art-direction rules, a doctrine per genre (product-launch, explainer, social-hook, cinematic-trailer, ' +
        'calm-tutorial), validated scene blueprints with [slot] copy and a signature move, a verb / useWhen / ' +
        'avoidWhen / pairsWith for every preset, transition and graphic, the fx primitives with their open ' +
        'parameters, and a complete starter template. The creative-kit library animations are listed only under ' +
        '`samples`: stock demo overlays, each mapped to the engine primitives that replace it (a last resort). ' +
        'Pass `query` (and optionally `kind`) for ranked matches instead of the whole catalog (engine primitives ' +
        'always rank above samples); an empty result carries a `gap` — then call report_catalog_gap. Call it ' +
        'before authoring animated copy, camera moves, graphics or designed transitions, and compose the motion ' +
        'from these primitives tuned to the brief instead of picking stock looks.',
      inputSchema,
    },
    (args: CatalogArgs) => ({
      content: [{ type: 'text', text: JSON.stringify(catalogResponse(args), null, 2) }],
    })
  );
}
