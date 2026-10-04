import { existsSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { McpConfig } from '../config.js';
import { assertWithinMediaDir } from '../compose/pathGuard.js';
import { remotionBundleOptions } from './remotion-webpack-override.js';
import { createClipProgressHandler } from './clip-progress.js';

// bundle() (webpack over an arbitrary entry) and ensureBrowser() (can DOWNLOAD Chromium on first
// run) are otherwise unbounded — only renderMedia carries a cancel signal. Bound the setup steps too
// so a hung bundle/download can't block the tool indefinitely.
const SETUP_TIMEOUT_MS = 300_000;

export async function withTimeout<T>(
  label: string,
  ms: number,
  run: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  signal?.throwIfAborted();
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    if (signal) {
      onAbort = () => {
        reject(new Error('Remotion operation aborted', { cause: signal.reason }));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    timer.unref();
  });

  try {
    return await Promise.race([run(), timeout, aborted]);
  } finally {
    clearTimeout(timer);

    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}

const inputSchema = z.object({
  // Path to the consumer's Remotion entry (the module that calls registerRoot). Falls back to the
  // server's configured default (LECLAP_MCP_REMOTION_ENTRY). `serveUrl` skips bundling entirely.
  entry: z.string().optional(),
  serveUrl: z.string().optional(),
  compositionId: z.string(),
  inputProps: z.record(z.string(), z.unknown()).optional(),
  outputName: z
    .string()
    .regex(/^[\w-]+$/)
    .optional(),
});

const outputSchema = z.object({
  path: z.string(),
  width: z.number(),
  height: z.number(),
  durationSeconds: z.number(),
  sectionHint: z.string(),
});

type ClipArgs = {
  entry?: string;
  serveUrl?: string;
  compositionId: string;
  inputProps?: Record<string, unknown>;
  outputName?: string;
};
type ToolError = { isError: true; content: [{ type: 'text'; text: string }] };

function errorResult(text: string): ToolError {
  return { isError: true, content: [{ type: 'text', text }] };
}

// Remotion is an OPTIONAL peer dependency, loaded only when this tool runs so the MCP stays
// self-contained for consumers who don't use it. A missing module surfaces as a clear error.
export type RemotionModules = {
  bundle: (options: {
    entryPoint: string;
    webpackOverride?: unknown;
    publicDir?: string;
    outDir?: string;
  }) => Promise<string>;
  ensureBrowser: () => Promise<unknown>;
  selectComposition: (options: {
    serveUrl: string;
    id: string;
    inputProps?: unknown;
    browserExecutable?: string;
    timeoutInMilliseconds?: number;
  }) => Promise<{
    width: number;
    height: number;
    durationInFrames: number;
    fps: number;
  }>;
  renderMedia: (options: Record<string, unknown>) => Promise<unknown>;
  renderStill: (options: Record<string, unknown>) => Promise<unknown>;
  makeCancelSignal: () => { cancelSignal: unknown; cancel: () => void };
};

export async function loadRemotion(): Promise<RemotionModules | { error: string }> {
  try {
    const bundler = (await import('@remotion/bundler')) as unknown as { bundle: RemotionModules['bundle'] };
    const renderer = (await import('@remotion/renderer')) as unknown as Omit<RemotionModules, 'bundle'>;

    return { bundle: bundler.bundle, ...renderer };
  } catch {
    return {
      error:
        'render_remotion_clip needs Remotion. Install the optional peer deps `@remotion/renderer` and ' +
        '`@remotion/bundler` (v4+) in your project to use it.',
    };
  }
}

// Remotion renders the bundle behind `serveUrl` in headless Chromium, so a REMOTE serveUrl would
// execute attacker-hosted JS (no pre-existing file needed). Restrict it to a local bundle path /
// file: / loopback http. NOTE: `entry` is the consumer's own Remotion project module and is bundled
// (and executed) as-is by design — this tool is design-time/local-only, so do NOT expose the server
// to untrusted clients.
// Realpath-contain a local/file: serveUrl to the media dir (symlink-safe, same guard as compose and
// probe use). Returns the original serveUrl on success, or a tool error on escape / missing path.
async function assertLocalPathAllowed(
  candidate: string,
  mediaDir: string,
  original: string
): Promise<string | ToolError> {
  try {
    await assertWithinMediaDir(path.resolve(candidate), mediaDir);

    return original;
  } catch (error) {
    return errorResult(
      `serveUrl must stay under the media dir (${mediaDir}): ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function assertServeUrlAllowed(serveUrl: string, mediaDir: string): Promise<string | ToolError> {
  let url: URL;

  try {
    url = new URL(serveUrl);
  } catch {
    return assertLocalPathAllowed(serveUrl, mediaDir, serveUrl); // not a URL — a local bundle path
  }

  if (url.protocol === 'file:') {
    return assertLocalPathAllowed(fileURLToPath(url), mediaDir, serveUrl);
  }

  if (url.protocol === 'http:' || url.protocol === 'https:') {
    const host = url.hostname.replace(/^\[|\]$/g, '');

    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
      return serveUrl;
    }

    return errorResult(`Remote serveUrl is not allowed (only localhost): ${serveUrl}`);
  }

  return errorResult(`Unsupported serveUrl scheme: ${serveUrl}`);
}

// A prebuilt serveUrl wins; otherwise bundle the consumer's entry (per-call or configured default).
async function resolveServeUrl(
  args: ClipArgs,
  config: McpConfig,
  remotion: RemotionModules
): Promise<{ serveUrl: string } | ToolError> {
  if (args.serveUrl) {
    const checked = await assertServeUrlAllowed(args.serveUrl, config.mediaDir);

    return typeof checked === 'string' ? { serveUrl: checked } : checked;
  }

  const entry = args.entry ?? config.remotionEntry;

  if (!entry) {
    return errorResult(
      'Provide `entry` (path to your Remotion registerRoot module) or a prebuilt `serveUrl`, or ' +
        'start the server with --remotion-entry / LECLAP_MCP_REMOTION_ENTRY.'
    );
  }

  if (!existsSync(entry)) {
    return errorResult(`Remotion entry not found: ${entry}`);
  }

  const options = await remotionBundleOptions(entry);

  return {
    serveUrl: await withTimeout('Remotion bundle', SETUP_TIMEOUT_MS, () => remotion.bundle(options)),
  };
}

function clipOutputPath(config: McpConfig, outputName?: string): string {
  const dir = path.join(config.mediaDir, '.leclap-remotion');
  mkdirSync(dir, { recursive: true });
  const name = outputName ?? `clip-${randomBytes(3).toString('hex')}`;

  return path.join(dir, `${name}.mp4`);
}

interface RenderJob {
  serveUrl: string;
  composition: unknown;
  outPath: string;
  inputProps?: Record<string, unknown>;
  timeoutMs: number;
  /** Correlates the stderr progress lines with this render. */
  renderId: string;
}

// Render the selected composition to `outPath`, cancelling if it overruns the render timeout.
async function renderToFile(remotion: RemotionModules, job: RenderJob): Promise<ToolError | undefined> {
  const { cancelSignal, cancel } = remotion.makeCancelSignal();
  const timer = setTimeout(cancel, job.timeoutMs);

  try {
    await remotion.renderMedia({
      composition: job.composition,
      serveUrl: job.serveUrl,
      codec: 'h264',
      outputLocation: job.outPath,
      inputProps: job.inputProps,
      cancelSignal,
      onProgress: createClipProgressHandler(job.renderId),
    });

    return undefined;
  } catch (error) {
    return errorResult(`Remotion render failed: ${describe(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

async function handleRender(args: ClipArgs, config: McpConfig) {
  const remotion = await loadRemotion();

  if ('error' in remotion) {
    return errorResult(remotion.error);
  }

  const resolved = await resolveServeUrl(args, config, remotion);

  if ('isError' in resolved) {
    return resolved;
  }

  const outPath = clipOutputPath(config, args.outputName);

  try {
    await withTimeout('Remotion ensureBrowser', SETUP_TIMEOUT_MS, () => remotion.ensureBrowser());
  } catch (error) {
    return errorResult(`Remotion browser setup failed: ${describe(error)}`);
  }

  let composition;

  try {
    composition = await withTimeout('Remotion selectComposition', SETUP_TIMEOUT_MS, () =>
      remotion.selectComposition({
        serveUrl: resolved.serveUrl,
        id: args.compositionId,
        inputProps: args.inputProps,
      })
    );
  } catch (error) {
    return errorResult(`Unknown or invalid composition "${args.compositionId}": ${describe(error)}`);
  }

  const failure = await renderToFile(remotion, {
    serveUrl: resolved.serveUrl,
    composition,
    outPath,
    inputProps: args.inputProps,
    timeoutMs: config.renderTimeoutMs,
    renderId: randomBytes(3).toString('hex'),
  });

  if (failure) {
    return failure;
  }

  const durationSeconds = composition.durationInFrames / composition.fps;
  const sectionHint =
    `Add a leading section { name: "intro", type: "project_video", options: { duration: ${durationSeconds} } } ` +
    `and call compose_video with userVideoPaths: { "intro": "${outPath}" } to composite this Remotion ` +
    'clip in front of your FFmpeg-rendered scenes.';

  return {
    content: [
      {
        type: 'text' as const,
        text: `Rendered Remotion composition "${args.compositionId}" → ${outPath} (${composition.width}x${composition.height}, ${durationSeconds}s). ${sectionHint}`,
      },
    ],
    structuredContent: {
      path: outPath,
      width: composition.width,
      height: composition.height,
      durationSeconds,
      sectionHint,
    },
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function registerRenderRemotionClip(server: McpServer, config: McpConfig): void {
  server.registerTool(
    'render_remotion_clip',
    {
      title: 'Render Remotion Clip',
      description:
        'Render a composition from YOUR Remotion project to an mp4 (real motion graphics an FFmpeg ' +
        'filtergraph cannot express). Point it at your Remotion entry (`entry`, or a prebuilt `serveUrl`, ' +
        'or the configured --remotion-entry) and a `compositionId`, with optional `inputProps`. Returns ' +
        'the clip path; feed it to compose_video as a `project_video` clip (see sectionHint) so FFmpeg ' +
        'composites it in front of your scenes. Needs the optional peer deps @remotion/renderer + ' +
        '@remotion/bundler; design-time only (headless Chromium), not an on-device path.',
      inputSchema,
      outputSchema,
    },
    (args: ClipArgs) => handleRender(args, config)
  );
}
