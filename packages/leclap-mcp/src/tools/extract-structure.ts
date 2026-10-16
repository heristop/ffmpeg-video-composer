// extract_structure: read a reference clip's format under the media dir — shots, rhythm, transitions,
// grounds, where the main element sits — as a structure and binding prompt rules. Pairs with
// extract_style (palette and pacing). The format only: never the reference's subjects, logos or text.

import type { McpServer, ServerContext } from '@modelcontextprotocol/server';
import { analyzeStructureFile, structurePromptRules, type ReferenceStructure } from 'ffmpeg-video-composer';
import { z } from 'zod';

import type { McpConfig } from '../config.js';
import { assertWithinMediaDir } from '../compose/pathGuard.js';

const STRUCTURE_TIMEOUT_MS = 60_000;

// The server is long-running and fed by agents: decode at most 2 minutes' worth at 0.25 s a frame (the
// CLI allows 1200). Longer clips are spread evenly across the cap rather than truncated.
const STRUCTURE_MAX_FRAMES = 480;

const inputSchema = z.object({
  path: z.string().describe('Absolute path of a reference clip under the media dir.'),
});

const outputSchema = z.object({
  structure: z.record(z.string(), z.unknown()),
  rules: z.string(),
});

export type StructureAnalyzer = (realPath: string, signal?: AbortSignal) => Promise<ReferenceStructure>;

function defaultAnalyzer(realPath: string, signal?: AbortSignal): Promise<ReferenceStructure> {
  return analyzeStructureFile(realPath, { signal, timeoutMs: STRUCTURE_TIMEOUT_MS, maxFrames: STRUCTURE_MAX_FRAMES });
}

function errorResult(text: string) {
  return { isError: true as const, content: [{ type: 'text' as const, text }] };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function handleExtractStructure(
  args: { path: string },
  config: McpConfig,
  analyzer: StructureAnalyzer = defaultAnalyzer,
  signal?: AbortSignal
) {
  let realPath: string;

  try {
    realPath = await assertWithinMediaDir(args.path, config.mediaDir);
  } catch (error) {
    return errorResult(message(error));
  }

  try {
    const structure = await analyzer(realPath, signal);
    const rules = structurePromptRules(structure);

    return {
      content: [{ type: 'text' as const, text: rules }],
      structuredContent: { structure: structure as unknown as Record<string, unknown>, rules },
    };
  } catch (error) {
    return errorResult(`Structure extraction failed: ${message(error)}`);
  }
}

export function registerExtractStructure(server: McpServer, config: McpConfig, analyzer?: StructureAnalyzer): void {
  server.registerTool(
    'extract_structure',
    {
      title: 'Extract Structure',
      description:
        'Read a reference clip (absolute path under the media dir) as a format: its shots with lengths, the ' +
        'transition into each (cut, fade, fadeblack), light or dark ground, where the main element sits on a ' +
        '3x3 grid and motion, plus the rhythm. Returns binding rules: build one section per shot, in order. ' +
        'Analyses at most 2 minutes at full resolution; a longer clip is sampled evenly, so its shots are coarser. ' +
        'Pair with extract_style for the palette. The format only: never copies subjects, logos or text.',
      inputSchema,
      outputSchema,
    },
    (args: { path: string }, ctx?: ServerContext) => handleExtractStructure(args, config, analyzer, ctx?.mcpReq.signal)
  );
}
