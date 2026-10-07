import fs from 'node:fs/promises';
import path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { McpConfig } from '../config.js';

// report_catalog_gap: when get_motion_catalog has nothing for a need, the agent records what it looked
// for and what it wanted, one JSON line per report. The log lives under the output dir (configurable
// with --catalog-gap-log / LECLAP_MCP_CATALOG_GAP_LOG, but never outside it), so maintainers can read
// what agents keep asking for.

const inputSchema = z.object({
  query: z.string().trim().min(1).max(200).describe('What was searched for in get_motion_catalog.'),
  wanted: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .describe('The motion, look or element that was missing, in a sentence or two.'),
});

export const DEFAULT_GAP_LOG = 'catalog-gaps.jsonl';

/** The gap log path: the configured one, else `<outputDir>/catalog-gaps.jsonl`. */
export function gapLogPath(config: Pick<McpConfig, 'outputDir' | 'catalogGapLog'>): string {
  return path.resolve(config.outputDir, config.catalogGapLog ?? DEFAULT_GAP_LOG);
}

function inside(child: string, root: string): boolean {
  return child.startsWith(root + path.sep);
}

/**
 * Where to append, after checking the log stays under the output dir: lexically, then again through
 * realpath once its folder exists (a symlinked folder or log file must not lead outside). Throws otherwise.
 */
export async function safeGapLog(config: Pick<McpConfig, 'outputDir' | 'catalogGapLog'>): Promise<string> {
  const root = path.resolve(config.outputDir);
  const file = gapLogPath(config);

  if (!inside(file, root)) throw new Error(`the catalog gap log must stay under the output dir (${root})`);

  await fs.mkdir(path.dirname(file), { recursive: true });
  const [realRoot, realDir] = await Promise.all([fs.realpath(root), fs.realpath(path.dirname(file))]);

  if (realDir !== realRoot && !inside(realDir, realRoot)) {
    throw new Error('the catalog gap log folder resolves outside the output dir');
  }

  const existing = await fs.lstat(file).catch(() => null);

  if (existing && !existing.isFile()) throw new Error('the catalog gap log is not a regular file');

  return file;
}

export async function reportGap(input: z.infer<typeof inputSchema>, config: McpConfig) {
  try {
    const file = await safeGapLog(config);
    const entry = { at: new Date().toISOString(), query: input.query, wanted: input.wanted };

    await fs.appendFile(file, `${JSON.stringify(entry)}\n`, 'utf8');

    return { content: [{ type: 'text' as const, text: `Recorded the catalog gap in ${file}. Thank you.` }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return { isError: true as const, content: [{ type: 'text' as const, text: `Gap not recorded: ${message}` }] };
  }
}

export function registerReportCatalogGap(server: McpServer, config: McpConfig): void {
  server.registerTool(
    'report_catalog_gap',
    {
      title: 'Report Catalog Gap',
      description:
        'Record a motion need the catalog could not answer (get_motion_catalog returned a `gap`): what you ' +
        'searched for and what you wanted. Appends one JSON line to a log under the server output dir.',
      inputSchema,
    },
    (args: z.infer<typeof inputSchema>) => reportGap(args, config)
  );
}
