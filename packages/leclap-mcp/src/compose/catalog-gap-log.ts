import fs from 'node:fs/promises';
import path from 'node:path';

import type { McpConfig } from '../config.js';

// The catalog gap log: every get_motion_catalog query that matched nothing, one JSON line each, so
// maintainers can read what agents keep asking for. It lives under the output dir (configurable with
// --catalog-gap-log / LECLAP_MCP_CATALOG_GAP_LOG, but never outside it).

type GapConfig = Pick<McpConfig, 'outputDir' | 'catalogGapLog'>;

export const DEFAULT_GAP_LOG = 'catalog-gaps.jsonl';

/** The gap log path: the configured one, else `<outputDir>/catalog-gaps.jsonl`. */
export function gapLogPath(config: GapConfig): string {
  return path.resolve(config.outputDir, config.catalogGapLog ?? DEFAULT_GAP_LOG);
}

function inside(child: string, root: string): boolean {
  return child.startsWith(root + path.sep);
}

/**
 * Where to append, after checking the log stays under the output dir: lexically, then again through
 * realpath once its folder exists (a symlinked folder or log file must not lead outside). Throws otherwise.
 */
export async function safeGapLog(config: GapConfig): Promise<string> {
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

/** Append one gap record. Best effort: a log that cannot be written never fails the search. */
export async function logCatalogGap(config: GapConfig, gap: { query: string; kind?: string }): Promise<void> {
  try {
    const file = await safeGapLog(config);
    const entry = { at: new Date().toISOString(), query: gap.query, ...(gap.kind ? { kind: gap.kind } : {}) };

    await fs.appendFile(file, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // Advisory log only.
  }
}
