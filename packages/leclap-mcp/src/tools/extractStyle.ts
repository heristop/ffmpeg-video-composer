// extract_style: derive a `global.theme` object and a style guide from a reference image or clip under
// the media dir — palette (k-means in OKLab, roles with WCAG AA contrast), texture (grain) and, for
// clips, pacing and motion energy. The engine decodes through ffmpeg into a buffer, never stdout, so
// the stdio JSON-RPC framing stays clean. Subjects, logos and text are never described or copied.

import type { McpServer, ServerContext } from '@modelcontextprotocol/server';
import { analyzeStyleFile, styleGuideMarkdown, type StyleAnalysis } from 'ffmpeg-video-composer';
import { z } from 'zod';

import type { McpConfig } from '../config.js';
import { assertWithinMediaDir } from '../compose/pathGuard.js';

// Decoding at most 240 frames of 160 px wide is quick; bound it so a pathological input can't hang.
const STYLE_TIMEOUT_MS = 60_000;

const inputSchema = z.object({
  path: z.string().describe('Absolute path of a reference image or clip under the media dir.'),
  seed: z
    .number()
    .int()
    .min(0)
    .max(4_294_967_295)
    .optional()
    .describe('Palette seed: the same reference and seed always give the same theme.'),
});

const outputSchema = z.object({
  theme: z.record(z.string(), z.unknown()),
  styleGuide: z.record(z.string(), z.unknown()),
  confidence: z.number(),
});

export type StyleAnalyzer = (
  realPath: string,
  seed: number | undefined,
  signal?: AbortSignal
) => Promise<StyleAnalysis>;

function defaultAnalyzer(realPath: string, seed: number | undefined, signal?: AbortSignal): Promise<StyleAnalysis> {
  return analyzeStyleFile(realPath, { seed, signal, timeoutMs: STYLE_TIMEOUT_MS });
}

function errorResult(text: string) {
  return { isError: true as const, content: [{ type: 'text' as const, text }] };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function handleExtractStyle(
  args: { path: string; seed?: number },
  config: McpConfig,
  analyzer: StyleAnalyzer = defaultAnalyzer,
  signal?: AbortSignal
) {
  let realPath: string;

  try {
    realPath = await assertWithinMediaDir(args.path, config.mediaDir);
  } catch (error) {
    return errorResult(message(error));
  }

  try {
    const analysis = await analyzer(realPath, args.seed, signal);

    return {
      content: [{ type: 'text' as const, text: styleGuideMarkdown(analysis) }],
      structuredContent: analysis as unknown as Record<string, unknown>,
    };
  } catch (error) {
    return errorResult(`Style extraction failed: ${message(error)}`);
  }
}

export function registerExtractStyle(server: McpServer, config: McpConfig, analyzer?: StyleAnalyzer): void {
  server.registerTool(
    'extract_style',
    {
      title: 'Extract Style',
      description:
        'Derive a global.theme object and a style guide from a reference image or clip (absolute path under ' +
        'the media dir): palette with roles, area shares and WCAG contrast, grain texture, and for clips the ' +
        'pacing (average shot, cuts per minute), motion energy and a suggested doctrine genre. Palette and ' +
        'pacing only: never copies subjects, logos or text. Set the returned theme as global.theme.',
      inputSchema,
      outputSchema,
    },
    (args: { path: string; seed?: number }, ctx?: ServerContext) =>
      handleExtractStyle(args, config, analyzer, ctx?.mcpReq.signal)
  );
}
