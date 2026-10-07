import type { EffectCacheSummary } from '../effects/effect-runner.js';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { McpServer, ServerContext } from '@modelcontextprotocol/server';
import {
  type ProjectConfig,
  type QcReport,
  type TemplateDescriptor,
  type ResolvedEffectProvenance,
} from 'ffmpeg-video-composer';
import { z } from 'zod';

import { resolveComposeEffects } from '../effects/compose-effects.js';
import { templateRevision } from '../effects/template-revision.js';
import type { McpConfig } from '../config.js';
import { assertWithinMediaDir } from '../compose/pathGuard.js';
import { assertDescriptorSafe } from '../compose/descriptorGuard.js';
import { validateTemplate } from '../compose/validation.js';
import { runRender, type RenderResult } from '../compose/renderRunner.js';
import { applyOutputName, pruneRenderDir, removeDir } from '../compose/renderDir.js';
import { formatArg, prepareComposeTemplate } from '../compose/format.js';

// Standard Schema objects, not the raw `{ field: z.type() }` shapes: the SDK's raw-shape overload is
// deprecated since v2 and the object form is what `tools/list` converts to JSON Schema.
const inputSchema = z.object({
  template: z.record(z.string(), z.unknown()),
  expectedRevision: z.string().optional(),
  fields: z.record(z.string(), z.string()).optional(),
  userVideoPaths: z.record(z.string(), z.string()).optional(),
  locale: z.string().optional(),
  format: formatArg,
  outputBaseName: z
    .string()
    .regex(/^[\w-]+$/)
    .optional(),
});

// The engine's output QC report (probe + one decode pass) for the rendered file.
const qcValue = z.union([z.string(), z.number(), z.null()]);
const qcSchema = z.object({
  verified: z.boolean(),
  content: z.boolean(),
  findings: z.array(
    z.object({
      check: z.string(),
      status: z.enum(['pass', 'warn', 'fail']),
      value: qcValue,
      expected: qcValue,
      reason: z.string(),
      kind: z.enum(['format', 'judgement']),
    })
  ),
});

const outputSchema = z.object({
  outputPath: z.string(),
  durationSeconds: z.number().nullable(),
  sizeBytes: z.number(),
  videoCodec: z.string().nullable(),
  audioCodec: z.string().nullable(),
  renderId: z.string(),
  effectProvenance: z.record(z.string(), z.unknown()).optional(),
  effectCache: z.object({ hits: z.number(), misses: z.number(), writes: z.number() }).optional(),
  qc: qcSchema.optional(),
});

export type ComposeArgs = {
  template: Record<string, unknown>;
  expectedRevision?: string;
  fields?: Record<string, string>;
  userVideoPaths?: Record<string, string>;
  locale?: string;
  format?: 'landscape' | 'portrait' | 'square';
  outputBaseName?: string;
};

export type ToolError = { isError: true; content: [{ type: 'text'; text: string }] };
type DescriptorResult = { ok: true; descriptor: TemplateDescriptor } | ToolError;

export function errorResult(text: string): ToolError {
  return { isError: true, content: [{ type: 'text', text }] };
}

// Validate the inline descriptor against the core schema before rendering.
function resolveDescriptor(args: ComposeArgs): DescriptorResult {
  const result = validateTemplate(args.template);

  if (!result.ok) {
    return errorResult(result.message);
  }

  return { ok: true, descriptor: result.descriptor };
}

function requiredVideoSections(descriptor: TemplateDescriptor): string[] {
  const sections = descriptor.sections ?? [];

  return sections
    .filter((section) => section.type === 'project_video' && typeof section.name === 'string')
    .map((section) => section.name as string);
}

// Reject when a required project_video section has no supplied clip, or when a supplied key names a
// section the template does not declare.
export function checkSectionCoverage(
  descriptor: TemplateDescriptor,
  provided: Record<string, string>
): ToolError | undefined {
  const required = requiredVideoSections(descriptor);
  const missing = required.filter((name) => !(name in provided));

  if (missing.length > 0) {
    return errorResult(`Missing clips for project_video section(s): ${missing.join(', ')}.`);
  }

  const known = new Set(required);
  const unknown = Object.keys(provided).filter((name) => !known.has(name));

  if (unknown.length > 0) {
    return errorResult(`Unknown userVideoPaths section(s): ${unknown.join(', ')}.`);
  }

  return undefined;
}

type SectionResolution = { section: string; real: string } | { section: string; error: string };

async function resolveOne(section: string, value: string, mediaDir: string): Promise<SectionResolution> {
  try {
    return { section, real: await assertWithinMediaDir(value, mediaDir) };
  } catch (error) {
    return { section, error: error instanceof Error ? error.message : String(error) };
  }
}

// Realpath-check every provided clip against the media dir (rejects traversal/symlink escape),
// returning the canonicalized map the worker will receive. Checks run in parallel; the first
// rejection wins.
export async function resolveVideoPaths(
  provided: Record<string, string>,
  mediaDir: string
): Promise<{ ok: true; paths: Record<string, string> } | ToolError> {
  const resolutions = await Promise.all(
    Object.entries(provided).map(([section, value]) => resolveOne(section, value, mediaDir))
  );

  const failure = resolutions.find((entry): entry is { section: string; error: string } => 'error' in entry);

  if (failure) {
    return errorResult(failure.error);
  }

  const paths: Record<string, string> = {};

  for (const entry of resolutions) {
    if ('real' in entry) {
      paths[entry.section] = entry.real;
    }
  }

  return { ok: true, paths };
}

function newRenderId(): string {
  return `${Date.now()}-${randomBytes(3).toString('hex')}`;
}

async function buildProjectConfig(
  args: ComposeArgs,
  userVideoPaths: Record<string, string>,
  config: McpConfig,
  renderId: string
): Promise<ProjectConfig> {
  const buildDir = path.join(config.outputDir, renderId);
  await fs.mkdir(buildDir, { recursive: true });

  return {
    buildDir,
    // The engine treats assetsDir as its read-only asset LIBRARY and as a staged-read root
    // (assetsDir/tmpdir/buildDir are the only places local descriptor paths may resolve). The
    // media dir IS this server's library: pointing assetsDir at the fresh buildDir instead used
    // to make the engine reject descriptor assets under LECLAP_MCP_MEDIA_DIR that probe_media
    // and the fontfile guard both explicitly allow.
    assetsDir: config.mediaDir,
    userVideoPaths,
    fields: args.fields,
    currentLocale: args.locale,
    // Agent renders are evidence: the same descriptor must yield the same bytes (bit-exact muxing,
    // pinned encoder threads; see the engine's core/determinism/command-tap.ts).
    deterministic: true,
    // ...and checked: the engine probes and decodes the output once and reports findings (`qc`).
    qc: { content: true },
  };
}

// One line for the agent: the QC verdict and the checks that did not pass.
function qcSummary(qc: QcReport | undefined): string {
  if (!qc) return '';

  const flagged = qc.findings.filter((finding) => finding.status !== 'pass');
  const detail = flagged.map((finding) => `${finding.check} ${finding.status}: ${finding.reason}`).join('; ');

  return ` QC ${qc.verified ? 'verified' : 'not verified'}${detail ? ` (${detail})` : ''}.`;
}

function successPayload(
  result: Extract<RenderResult, { ok: true }>,
  renderId: string,
  effectProvenance?: Record<string, ResolvedEffectProvenance>,
  effectCache?: EffectCacheSummary
) {
  return {
    content: [
      {
        type: 'text' as const,
        text: `Rendered ${result.outputPath} (${result.durationSeconds ?? '?'}s, ${result.sizeBytes} bytes).${qcSummary(result.qc)}`,
      },
      // The protocol's pointer-to-an-artifact block: the client can open or fetch the file itself
      // rather than the server inlining megabytes of base64 mp4 into the conversation.
      {
        type: 'resource_link' as const,
        uri: pathToFileURL(result.outputPath).href,
        name: path.basename(result.outputPath),
        mimeType: 'video/mp4',
      },
    ],
    structuredContent: {
      outputPath: result.outputPath,
      durationSeconds: result.durationSeconds,
      sizeBytes: result.sizeBytes,
      videoCodec: result.videoCodec,
      audioCodec: result.audioCodec,
      renderId,
      ...(effectProvenance ? { effectProvenance } : {}),
      ...(effectCache ? { effectCache } : {}),
      ...(result.qc ? { qc: result.qc } : {}),
    },
  };
}

function failurePayload(result: Extract<RenderResult, { ok: false }>): ToolError {
  const tail = result.logTail ? `\n${result.logTail}` : '';

  return errorResult(`${result.error}${tail}`);
}

type PreparedCompose = {
  effectDirectories?: string[];
  effectCache?: EffectCacheSummary;
  ok: true;
  descriptor: TemplateDescriptor;
  paths: Record<string, string>;
  effectProvenance?: Record<string, ResolvedEffectProvenance>;
};

function checkEffectBindings(descriptor: TemplateDescriptor, provided: Record<string, string>) {
  const collisions = (descriptor.sections ?? [])
    .filter(
      (section) =>
        section.type === 'effect' && typeof section.name === 'string' && Object.hasOwn(provided, section.name)
    )
    .map((section) => section.name);

  if (collisions.length > 0) return errorResult(`Effect clip binding collision: ${collisions.join(', ')}.`);

  return checkSectionCoverage(descriptor, provided);
}

// Validate the descriptor, contain its raw filter chain, check section coverage, and realpath-guard
// every supplied clip — returning either the render-ready inputs or the first tool error.
export async function prepareCompose(
  authored: ComposeArgs,
  config: McpConfig,
  signal?: AbortSignal
): Promise<PreparedCompose | ToolError> {
  // Revision check, then the requested format's composition before anything checks or renders it.
  const args = prepareComposeTemplate(authored, templateRevision);

  if ('isError' in args) return args;
  const descriptor = resolveDescriptor(args);

  if ('isError' in descriptor) return descriptor;

  // Contain the descriptor's raw filter chain (source filters, file/URL-bearing values, fontfile
  // paths) before it reaches ffmpeg — the schema alone does not stop it escaping the media-dir sandbox.
  const safety = await assertDescriptorSafe(descriptor.descriptor, config.mediaDir);

  if (!safety.ok) return errorResult(safety.message);

  const provided = args.userVideoPaths ?? {};
  const bindingError = checkEffectBindings(descriptor.descriptor, provided);

  if (bindingError) return bindingError;
  const resolved = await resolveVideoPaths(provided, config.mediaDir);

  if ('isError' in resolved) return resolved;

  if (descriptor.descriptor.sections?.some((section) => section.type === 'effect')) {
    try {
      return await resolveComposeEffects(args.template, config, resolved.paths, signal);
    } catch (error) {
      return errorResult(`Effect preparation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { ok: true, descriptor: descriptor.descriptor, paths: resolved.paths };
}

// Name the deliverable and prune the render dir down to it, then build the success payload.
async function finalizeRender(
  result: Extract<RenderResult, { ok: true }>,
  args: ComposeArgs,
  renderId: string,
  effectProvenance?: Record<string, ResolvedEffectProvenance>,
  effectCache?: EffectCacheSummary
) {
  const outputPath = await applyOutputName(result.outputPath, args.outputBaseName);
  // Keep only the deliverable(s); the engine's intermediate segments/concat lists/staged assets are
  // dead weight once the final mp4 exists. Prune the dir that actually holds the output (both the
  // named copy and the engine output live there), so this is safe whether or not the engine nests
  // its output under buildDir. Best-effort — never fail a good render on cleanup.
  await pruneRenderDir(path.dirname(result.outputPath), [path.basename(outputPath), path.basename(result.outputPath)]);

  return successPayload({ ...result, outputPath }, renderId, effectProvenance, effectCache);
}

// Render progress goes to stderr, not to a `notifications/message`: `ctx.mcpReq.log` is deprecated
// as of protocol 2026-07-28 (SEP-2577), which names stderr as the replacement for STDIO servers.
// stderr is also the only channel this server may write diagnostics on — stdout carries JSON-RPC
// framing and is owned by the stdout guard. Synchronous and never throws, so a render can't fail on
// its own telemetry.
function progressLogger(renderId: string): (fraction: number) => void {
  return (fraction: number): void => {
    console.error(`[compose_video] render ${renderId} ${Math.round(fraction * 100)}%`);
  };
}

async function handleCompose(args: ComposeArgs, config: McpConfig, ctx?: ServerContext) {
  const prepared = await prepareCompose(args, config, ctx?.mcpReq.signal);

  if ('isError' in prepared) {
    return prepared;
  }

  try {
    const renderId = newRenderId();
    const buildDir = path.join(config.outputDir, renderId);
    const projectConfig = await buildProjectConfig(args, prepared.paths, config, renderId);
    const result = await runRender(
      { projectConfig, template: prepared.descriptor },
      {
        timeoutMs: config.renderTimeoutMs,
        signal: ctx?.mcpReq.signal,
        onProgress: progressLogger(renderId),
      }
    );

    if (!result.ok) {
      // Nothing usable was produced — drop the whole render dir so failed/cancelled calls don't
      // accumulate on disk.
      await removeDir(buildDir);

      return failurePayload(result);
    }

    return await finalizeRender(result, args, renderId, prepared.effectProvenance, prepared.effectCache);
  } finally {
    await Promise.all(
      (prepared.effectDirectories ?? []).map((directory) => pruneRenderDir(directory, ['provenance.json']))
    );
  }
}

export function registerCompose(server: McpServer, config: McpConfig): void {
  server.registerTool(
    'compose_video',
    {
      title: 'Compose Video',
      description:
        'Render a video from an inline template descriptor (`template`). Supply user clips via ' +
        'userVideoPaths (absolute paths under the configured media dir) for each project_video ' +
        'section, optional form `fields`, an optional `locale` and an optional `format` (the template ' +
        'composition for landscape | portrait | square). Renders in a forked worker and ' +
        'returns the output mp4 path plus duration/codec metadata.',
      inputSchema,
      outputSchema,
    },
    // The v2 handler context replaces v1's flat `extra`: cancellation lives at `ctx.mcpReq.signal`
    // and the per-request log channel at `ctx.mcpReq.log`. Optional so the unit tests can invoke the
    // handler with args alone.
    (args: ComposeArgs, ctx?: ServerContext) => handleCompose(args, config, ctx)
  );
}
