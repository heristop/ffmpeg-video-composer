// extract_brand: read a website's brand — name, colours, fonts, logo — into a kit saved under the media
// dir (brand-kits/<host>/), a global.theme and binding prompt rules. Registered only with --allow-network:
// it fetches over HTTPS from public hosts only, with size and time caps.

import path from 'node:path';
import type { McpServer, ServerContext } from '@modelcontextprotocol/server';
import { brandPromptRules, brandTheme, fetchBrandKit, saveBrandKit, type BrandKit } from 'ffmpeg-video-composer';
import { z } from 'zod';

import type { McpConfig } from '../config.js';

const inputSchema = z.object({ url: z.url().describe('https:// URL of the brand’s website.') });

const outputSchema = z.object({
  kit: z.record(z.string(), z.unknown()),
  theme: z.record(z.string(), z.unknown()),
  rules: z.string(),
  dir: z.string(),
  logoError: z.string().optional(),
});

export type BrandFetcher = (url: string, signal?: AbortSignal) => Promise<BrandKit>;

function defaultFetcher(url: string, signal?: AbortSignal): Promise<BrandKit> {
  return fetchBrandKit(url, { signal });
}

function errorResult(text: string) {
  return { isError: true as const, content: [{ type: 'text' as const, text }] };
}

// The folder is named after the host the fetch ended on (post-redirect), which a remote site controls.
// Keep only [a-z0-9.-], drop leading dots so it can never be `.` or `..`, and refuse an empty result.
export function brandFolderName(hostname: string): string {
  const name = hostname
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '')
    .replace(/^[.-]+/, '')
    .replace(/\.{2,}/g, '.');

  if (name === '') {
    throw new Error(`cannot derive a safe folder name from host "${hostname}"`);
  }

  return name;
}

function brandDir(mediaDir: string, kitUrl: string): string {
  const root = path.resolve(mediaDir, 'brand-kits');
  const dir = path.resolve(root, brandFolderName(new URL(kitUrl).hostname));

  if (path.dirname(dir) !== root) {
    throw new Error('brand folder escapes the media dir');
  }

  return dir;
}

export async function handleExtractBrand(
  args: { url: string },
  config: McpConfig,
  fetcher: BrandFetcher = defaultFetcher,
  signal?: AbortSignal
) {
  try {
    const kit = await fetcher(args.url, signal);
    const dir = brandDir(config.mediaDir, kit.url);
    const saved = await saveBrandKit(kit, dir, { signal });
    const theme = brandTheme(saved.kit);
    const rules = brandPromptRules(saved.kit, theme, saved.logo ?? undefined);

    return {
      content: [{ type: 'text' as const, text: rules }],
      structuredContent: {
        kit: saved.kit as unknown as Record<string, unknown>,
        theme: theme.theme as unknown as Record<string, unknown>,
        rules,
        dir,
        ...(saved.logoError ? { logoError: saved.logoError } : {}),
      },
    };
  } catch (error) {
    return errorResult(`Brand extraction failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function registerExtractBrand(server: McpServer, config: McpConfig, fetcher?: BrandFetcher): void {
  server.registerTool(
    'extract_brand',
    {
      title: 'Extract Brand',
      description:
        'Read a website (https only) into a brand kit: its name, colours with roles and WCAG contrast, fonts ' +
        '(bundled ids, plus the exact families as font objects) and logo, saved under the media dir. Returns ' +
        'a global.theme and binding rules: set the theme, write the name exactly, show the logo unaltered.',
      inputSchema,
      outputSchema,
    },
    (args: { url: string }, ctx?: ServerContext) => handleExtractBrand(args, config, fetcher, ctx?.mcpReq.signal)
  );
}
