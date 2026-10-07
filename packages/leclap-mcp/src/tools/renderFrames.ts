import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { McpServer, ServerContext } from '@modelcontextprotocol/server';
import type { CompareVariant, SnapshotOptions } from 'ffmpeg-video-composer';
import { z } from 'zod';

import type { McpConfig } from '../config.js';
import { runSnapshot } from '../compose/snapshotRunner.js';
import { pruneRenderDir, removeDir } from '../compose/renderDir.js';
import type { SnapshotJob, SnapshotOutcome } from '../worker/snapshot-job.js';
import { formatArg } from '../compose/format.js';
import { errorResult, prepareCompose, type ComposeArgs, type ToolError } from './composeVideo.js';

// render_frames: the agent's eyes. Renders a native template (through the per-section cache under the
// output dir, so a second look after a small edit re-encodes only what changed) and returns still
// frames as MCP image content, plus their paths. Same sandbox as compose_video: the descriptor and its
// clips are checked against the media dir, the render runs in the forked worker under the same slot
// cap, timeout and cancellation, and every file lands under the output dir.

const time = z.union([z.number().nonnegative(), z.string().min(1).max(80)]);
const region = z.number().nonnegative();

export const renderFramesInput = z.object({
  template: z.record(z.string(), z.unknown()),
  at: z
    .array(time)
    .max(24)
    .optional()
    .describe(
      'Moments to grab, on the whole video: seconds, or "<section>.start|end", "<id>.start|end" (an element id), ' +
        '"50%", "end", "beat:8", "bar:2", "cue:drop", each with an optional "+ 0.2" / "- 0.1".'
    ),
  atTransitions: z.boolean().optional().describe('Each section boundary, 0.1 s before and 0.2 s after the cut.'),
  perSection: z
    .boolean()
    .optional()
    .describe('Each section once its last kinetic/graphic entrance has landed (+0.2 s). The default plan.'),
  sheet: z
    .object({ cols: z.number().int().min(1).max(6), rows: z.number().int().min(1).max(6) })
    .optional()
    .describe('Tile the frames into labelled contact sheets (time + section per tile); returns the sheets as images.'),
  safe: z
    .string()
    .optional()
    .describe('Shade a delivery platform UI zones (tiktok, reels, shorts, youtube…) to check text stays clear.'),
  zoom: z
    .object({ x: region, y: region, w: region, h: region })
    .optional()
    .describe('Crop every frame to x/y/w/h, fractions of the frame (0..1) or pixels.'),
  variants: z
    .array(z.record(z.string(), z.unknown()))
    .min(1)
    .max(5)
    .optional()
    .describe('Other templates to compare: the first `at` moment of `template` and of each, in one labelled grid.'),
  looks: z
    .boolean()
    .optional()
    .describe('Tile the section at the first `at` moment once per LOOK preset (the section alone; slow).'),
  fields: z.record(z.string(), z.string()).optional(),
  userVideoPaths: z.record(z.string(), z.string()).optional(),
  locale: z.string().optional(),
  format: formatArg,
});

type FramesArgs = z.infer<typeof renderFramesInput>;

const image = z.object({ path: z.string(), width: z.number(), height: z.number() });

const outputSchema = z.object({
  outputDir: z.string(),
  frames: z.array(image.extend({ time: z.number(), label: z.string(), section: z.string() })),
  sheets: z.array(image),
});

/** Frames inlined as images at most; the rest are returned as paths only. */
const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function composeArgs(template: Record<string, unknown>, args: FramesArgs): ComposeArgs {
  // The format resolves inside prepareCompose, before validation and the sandbox guard.
  return {
    template,
    fields: args.fields,
    userVideoPaths: args.userVideoPaths,
    locale: args.locale,
    format: args.format,
  };
}

function labelOf(template: Record<string, unknown>, fallback: string): string {
  const name = (template.meta as { name?: unknown } | undefined)?.name;

  return typeof name === 'string' && name.trim() !== '' ? name.trim().slice(0, 40) : fallback;
}

type Prepared = Exclude<Awaited<ReturnType<typeof prepareCompose>>, ToolError>;

// Every template through compose_video's own checks, one at a time (effect preparation may render): the
// first refusal is the answer.
async function prepareAll(
  args: FramesArgs,
  config: McpConfig,
  signal?: AbortSignal,
  done: Prepared[] = []
): Promise<Prepared[] | ToolError> {
  const templates = [args.template, ...(args.variants ?? [])];

  if (done.length === templates.length) return done;

  const result = await prepareCompose(composeArgs(templates[done.length], args), config, signal);

  return 'isError' in result ? result : prepareAll(args, config, signal, [...done, result]);
}

function snapshotJob(args: FramesArgs, prepared: Prepared[], options: SnapshotOptions): SnapshotJob {
  const [main] = prepared;
  const first = args.at?.at(0) ?? 0;

  if (args.variants) {
    const templates = [args.template, ...args.variants];
    const variants: CompareVariant[] = prepared.map((entry, i) => ({
      label: labelOf(templates[i], i === 0 ? 'template' : `variant-${i}`),
      descriptor: entry.descriptor,
    }));

    return { kind: 'snapshot', mode: 'compare', variants, options: { ...options, at: first } };
  }

  if (args.looks) {
    return { kind: 'snapshot', mode: 'looks', template: main.descriptor, options: { ...options, at: first } };
  }

  return { kind: 'snapshot', mode: 'frames', template: main.descriptor, options };
}

function snapshotOptions(args: FramesArgs, config: McpConfig, outDir: string, paths: Record<string, string>) {
  return {
    outDir,
    assetsDir: config.mediaDir,
    cacheDir: path.join(config.outputDir, '.section-cache'),
    workDir: config.outputDir,
    fields: args.fields,
    currentLocale: args.locale,
    userVideoPaths: paths,
    at: args.at,
    atTransitions: args.atTransitions,
    perSection: args.perSection,
    sheet: args.sheet,
    safe: args.safe,
    zoom: args.zoom,
  };
}

async function imageBlock(file: string) {
  const bytes = await fs.readFile(file);

  return bytes.byteLength > MAX_IMAGE_BYTES
    ? []
    : [{ type: 'image' as const, data: bytes.toString('base64'), mimeType: 'image/png' }];
}

/** The tool result: a one-line summary, the sheets (or the first frames) as images, every path. */
export async function framesPayload(snapshot: SnapshotOutcome, outputDir: string) {
  const shown = snapshot.sheets.length > 0 ? snapshot.sheets : snapshot.frames;
  const images = (await Promise.all(shown.slice(0, MAX_IMAGES).map((entry) => imageBlock(entry.path)))).flat();
  const list = snapshot.frames.map((frame) => `${frame.time.toFixed(2)}s ${frame.section} (${frame.label})`).join('; ');
  const text =
    `Rendered ${snapshot.frames.length} frame(s)${snapshot.sheets.length > 0 ? ` and ${snapshot.sheets.length} sheet(s)` : ''} ` +
    `into ${outputDir}: ${list}.${shown.length > MAX_IMAGES ? ` Showing the first ${MAX_IMAGES}; the rest are on disk.` : ''}`;

  return {
    content: [{ type: 'text' as const, text }, ...images],
    structuredContent: { outputDir, frames: snapshot.frames, sheets: snapshot.sheets },
  };
}

async function handleFrames(args: FramesArgs, config: McpConfig, ctx?: ServerContext) {
  const prepared = await prepareAll(args, config, ctx?.mcpReq.signal);

  if ('isError' in prepared) return prepared;

  const outputDir = path.join(config.outputDir, `frames-${Date.now()}-${randomBytes(3).toString('hex')}`);

  try {
    const options = snapshotOptions(args, config, outputDir, prepared[0].paths);
    const result = await runSnapshot(snapshotJob(args, prepared, options), {
      timeoutMs: config.renderTimeoutMs,
      signal: ctx?.mcpReq.signal,
    });

    if (!result.ok) {
      await removeDir(outputDir);

      return errorResult(`render_frames failed: ${result.error}`);
    }

    return await framesPayload(result.snapshot, outputDir);
  } finally {
    const effectDirs = prepared.flatMap((entry) => entry.effectDirectories ?? []);

    await Promise.all(effectDirs.map((directory) => pruneRenderDir(directory, ['provenance.json'])));
  }
}

export function registerRenderFrames(server: McpServer, config: McpConfig): void {
  server.registerTool(
    'render_frames',
    {
      title: 'Render Frames',
      description:
        'Look at a native template: render it (section cache makes repeat looks fast) and return still frames ' +
        'as PNG images plus their paths. Pick moments with `at` (seconds or time references on the whole video), ' +
        '`atTransitions` and `perSection` (default); tile them with `sheet`, shade a platform UI with `safe`, crop ' +
        'with `zoom`; compare templates with `variants` or every LOOK preset with `looks`. Call it after ' +
        'validate_template to check composition, contrast and safe zones before compose_video.',
      inputSchema: renderFramesInput,
      outputSchema,
    },
    (args: FramesArgs, ctx?: ServerContext) => handleFrames(args, config, ctx)
  );
}
