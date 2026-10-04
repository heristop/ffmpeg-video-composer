import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { McpServer, ServerContext } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { McpConfig } from '../config.js';
import { validateTemplate } from '../compose/validation.js';
import { assertDescriptorSafe } from '../compose/descriptorGuard.js';
import { validateEffects } from '../effects/title-registry.js';
import { runTitleEffect, type TitleWorkerResult } from '../effects/effect-runner.js';
import { templateRevision } from '../effects/template-revision.js';
import { checkSectionCoverage, resolveVideoPaths } from './composeVideo.js';

const inputSchema = z
  .object({
    template: z.record(z.string(), z.unknown()),
    section: z.string().min(1),
    frames: z
      .array(z.number().int().min(0).max(299))
      .min(1)
      .max(10)
      .refine((frames) => new Set(frames).size === frames.length, 'Frames must be distinct.')
      .optional(),
    frameRange: z
      .object({ from: z.number().int().min(0).max(299), to: z.number().int().min(0).max(299) })
      .strict()
      .refine(
        (range) => range.to >= range.from && range.to - range.from + 1 <= 90,
        'Inclusive range must contain 1..90 frames.'
      )
      .optional(),
    expectedRevision: z.string().optional(),
    userVideoPaths: z.record(z.string(), z.string()).optional(),
  })
  .strict()
  .refine((args) => Boolean(args.frames) !== Boolean(args.frameRange), 'Provide exactly one of frames or frameRange.');
type PreviewArgs = z.infer<typeof inputSchema>;
const IMAGE_BYTES_LIMIT = 10 * 1024 * 1024;
const CLIP_BYTES_LIMIT = 25 * 1024 * 1024;
async function preflightPreview(args: PreviewArgs, config: McpConfig, signal?: AbortSignal) {
  const revision = templateRevision(args.template);

  if (args.expectedRevision && args.expectedRevision !== revision) {
    throw new Error('revision_conflict: template changed; validate the current JSON first.');
  }
  const parsed = validateTemplate(args.template);

  if (!parsed.ok) throw new Error(parsed.message);
  const safety = await assertDescriptorSafe(parsed.descriptor, config.mediaDir);

  if (!safety.ok) throw new Error(safety.message);
  const coverage = checkSectionCoverage(parsed.descriptor, args.userVideoPaths ?? {});

  if (coverage) throw new Error(coverage.content[0].text);
  const paths = await resolveVideoPaths(args.userVideoPaths ?? {}, config.mediaDir);

  if ('isError' in paths) throw new Error(paths.content[0].text);
  const prepared = await validateEffects(args.template, config, signal);
  const title = prepared.get(args.section);

  if (!title) throw new Error(`effect_section_not_found: ${args.section}`);

  return { revision, title };
}

function requestsFor(args: PreviewArgs) {
  if (args.frames) return args.frames.map((frame) => ({ kind: 'still' as const, frame }));

  if (!args.frameRange) throw new Error('preview_range_invalid: provide a frame range.');

  return [{ kind: 'range' as const, ...args.frameRange }];
}

async function previewArtifacts(job: TitleWorkerResult, args: PreviewArgs) {
  const sizes = await Promise.all(job.results.map(async (result) => (await fs.stat(result.path)).size));
  const limit = args.frames ? IMAGE_BYTES_LIMIT : CLIP_BYTES_LIMIT;

  if (sizes.reduce((total, size) => total + size, 0) > limit) {
    throw new Error('preview_artifact_too_large: preview exceeds artifact byte limit; request fewer frames.');
  }
  const artifacts = job.results.map((result, index) => ({
    path: result.path,
    frame: args.frames?.[index],
    mimeType: args.frames ? 'image/png' : 'video/mp4',
    sizeBytes: sizes[index],
  }));
  const content = await Promise.all(
    artifacts.map(async (artifact) => {
      if (args.frames) {
        return {
          type: 'image' as const,
          mimeType: artifact.mimeType,
          data: (await fs.readFile(artifact.path)).toString('base64'),
        };
      }

      return {
        type: 'resource_link' as const,
        uri: pathToFileURL(artifact.path).href,
        name: path.basename(artifact.path),
        mimeType: artifact.mimeType,
      };
    })
  );

  return { artifacts, content };
}

function selectionLabel(args: PreviewArgs) {
  if (args.frames) return `frames ${args.frames.join(', ')}`;

  return `inclusive frames ${args.frameRange?.from}..${args.frameRange?.to}`;
}

async function handlePreview(input: PreviewArgs, config: McpConfig, ctx?: ServerContext) {
  let directory: string | undefined;

  try {
    const args = inputSchema.parse(input);
    ctx?.mcpReq.signal?.throwIfAborted();
    const { revision, title } = await preflightPreview(args, config, ctx?.mcpReq.signal);
    const job = await runTitleEffect(title, config, requestsFor(args), ctx?.mcpReq.signal);
    directory = job.directory;
    const { artifacts, content } = await previewArtifacts(job, args);
    await Promise.all(
      ['assets', 'bundle'].map((name) => fs.rm(path.join(job.directory, name), { recursive: true, force: true }))
    );

    return {
      content: [
        {
          type: 'text' as const,
          text: `Preview ${args.section} (${selectionLabel(args)}). Remotion text fit and contrast are not measured; inspect these pixels.`,
        },
        ...content,
      ],
      structuredContent: {
        revision,
        section: args.section,
        artifacts,
        provenance: job.provenance,
        cache: job.cache ?? { hits: 0, misses: 0, writes: 0 },
      },
    };
  } catch (error) {
    if (directory) await fs.rm(directory, { recursive: true, force: true }).catch(() => {});

    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            code: 'preview_failed',
            message: error instanceof Error ? error.message : String(error),
          }),
        },
      ],
    };
  }
}
export function registerRenderPreview(server: McpServer, config: McpConfig): void {
  server.registerTool(
    'render_preview',
    {
      title: 'Render Effect Preview',
      description:
        'Render a named inline JSON effect using the same trusted source, props/assets and composition configuration as compose_video. Request 1..10 distinct frames (0..299) for inline PNG images, or one inclusive frameRange of <=90 frames for a linked mp4. Checks optional expectedRevision before work. Requires configured trusted Remotion backend.',
      inputSchema,
    },
    (args: PreviewArgs, ctx?: ServerContext) => handlePreview(args, config, ctx)
  );
}
