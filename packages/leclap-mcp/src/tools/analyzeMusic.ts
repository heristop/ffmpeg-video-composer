import { createRequire } from 'node:module';

import type { McpServer, ServerContext } from '@modelcontextprotocol/server';
import { analyzeMusicFile, type BeatAnalysis } from 'ffmpeg-video-composer';
import { z } from 'zod';

import type { McpConfig } from '../config.js';
import { assertWithinMediaDir } from '../compose/pathGuard.js';

// analyze_music: measure a music track under the media dir — tempo, beat 1 (the first downbeat), bar
// length, confidence and the drop/build/end cues — and hand back the `global.beats` grid a template
// takes. Decodes with FFmpeg into memory (never writes to stdout) and runs the engine's deterministic
// analyzer.

const requireModule = createRequire(import.meta.url);

const inputSchema = z.object({
  path: z.string().describe('Absolute path of an audio file under the media dir.'),
  beatsPerBar: z.number().int().min(1).max(16).optional().describe('Beats per bar (default 4).'),
  includeTimes: z
    .boolean()
    .optional()
    .describe('Also return every tracked beat time (default false: the grid { bpm, offset } is enough).'),
});

const cuesSchema = z.object({ build: z.number().optional(), drop: z.number().optional(), end: z.number() });

const outputSchema = z.object({
  bpm: z.number(),
  offset: z.number(),
  beatsPerBar: z.number(),
  confidence: z.number(),
  usable: z.boolean(),
  cues: cuesSchema,
  beatCount: z.number(),
  times: z.array(z.number()).optional(),
  globalBeats: z.record(z.string(), z.unknown()),
  advice: z.string(),
});

type Args = z.infer<typeof inputSchema>;

export type MusicAnalyzer = (
  realPath: string,
  options: { beatsPerBar?: number; signal?: AbortSignal }
) => Promise<BeatAnalysis>;

// System FFmpeg first, then the ffmpeg-static binary when the operator installed it.
function ffmpegBinary(): string | undefined {
  try {
    return (requireModule('ffmpeg-static') as string | null) ?? undefined;
  } catch {
    return undefined;
  }
}

async function defaultAnalyzer(realPath: string, options: { beatsPerBar?: number; signal?: AbortSignal }) {
  try {
    return await analyzeMusicFile(realPath, options);
  } catch (error) {
    const fallback = ffmpegBinary();

    if (!fallback || options.signal?.aborted) throw error;

    return analyzeMusicFile(realPath, { ...options, ffmpeg: fallback });
  }
}

function advice(analysis: BeatAnalysis): string {
  if (!analysis.usable) {
    return (
      'No reliable pulse (calm or ambient music): pace by phrases — section lengths in seconds, entrances ' +
      'on the words — and do not hang cuts or hits on "beat:n".'
    );
  }

  const drop =
    analysis.cues.drop === undefined
      ? ''
      : ` Put the drop (${analysis.cues.drop}s) into the cues of the section playing then.`;

  return `Set global.beats to globalBeats; "beat:n" / "bar:n" and options.duration { beats } / { bars } then land on the music.${drop}`;
}

/** The tool's structured result for an analysis. */
export function analysisResult(analysis: BeatAnalysis, includeTimes = false) {
  return {
    bpm: analysis.bpm,
    offset: analysis.offset,
    beatsPerBar: analysis.beatsPerBar,
    confidence: analysis.confidence,
    usable: analysis.usable,
    cues: analysis.cues,
    beatCount: analysis.times.length,
    ...(includeTimes && { times: analysis.times }),
    globalBeats: {
      bpm: analysis.bpm,
      offset: analysis.offset,
      beatsPerBar: analysis.beatsPerBar,
      confidence: analysis.confidence,
      usable: analysis.usable,
    },
    advice: advice(analysis),
  };
}

function errorResult(text: string) {
  return { isError: true as const, content: [{ type: 'text' as const, text }] };
}

async function handleAnalyze(args: Args, config: McpConfig, analyzer: MusicAnalyzer, signal?: AbortSignal) {
  let realPath: string;

  try {
    realPath = await assertWithinMediaDir(args.path, config.mediaDir);
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }

  try {
    const analysis = await analyzer(realPath, { beatsPerBar: args.beatsPerBar, signal });
    const result = analysisResult(analysis, args.includeTimes);
    const summary = analysis.usable
      ? `${analysis.bpm} BPM, beat 1 at ${analysis.offset}s, confidence ${analysis.confidence}`
      : `no reliable pulse (confidence ${analysis.confidence})`;

    return {
      content: [{ type: 'text' as const, text: `Analyzed ${realPath}: ${summary}.` }],
      structuredContent: result,
    };
  } catch (error) {
    return errorResult(`Analysis failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function registerAnalyzeMusic(server: McpServer, config: McpConfig, analyzer: MusicAnalyzer = defaultAnalyzer) {
  server.registerTool(
    'analyze_music',
    {
      title: 'Analyze Music',
      description:
        'Measure a local music file (absolute path under the media dir): tempo (BPM), beat 1 offset, beats per ' +
        'bar, confidence, usable, and cues (build, drop, end). Returns globalBeats to paste into ' +
        'global.beats so "beat:n", "bar:n" and options.duration { beats } land on the music. usable=false ' +
        'means calm/ambient music: pace by phrases instead of beats.',
      inputSchema,
      outputSchema,
    },
    (args: Args, ctx?: ServerContext) => handleAnalyze(args, config, analyzer, ctx?.mcpReq.signal)
  );
}
