import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import type { EffectRenderResult } from 'ffmpeg-video-composer';
import type { McpConfig } from '../config.js';
import { assertWithinMediaDir } from '../compose/pathGuard.js';
import { remotionBundleOptions } from '../tools/remotion-webpack-override.js';
import { loadRemotion, type RemotionModules } from '../tools/renderRemotionClip.js';
import { type PreparedTitle } from './title-registry.js';
import { getEffectDefinition } from './effect-catalog.js';
import { hashFile, hashFiles } from './effect-hashes.js';
import { templateRevision } from './template-revision.js';

const SETUP_TIMEOUT_MS = 300_000;
export interface TitleJob {
  readonly directory: string;
  readonly serveUrl: string;
  readonly inputProps: Readonly<Record<string, unknown>>;
  readonly composition: { width: number; height: number; fps: number; durationInFrames: number };
  readonly provenance: {
    hash: string;
    effectId: string;
    effectVersion: string;
    compositionId: string;
    definitionHash: string;
    sourceHash: string;
    assetHashes: Record<string, string>;
    renderer: Record<string, string | number>;
  };
  readonly remotion: RemotionModules;
  readonly config: Readonly<McpConfig>;
  readonly signal?: AbortSignal;
}
export type TitleRender =
  | { kind: 'video' }
  | { kind: 'still'; frame: number }
  | { kind: 'range'; from: number; to: number };
async function snapshotAssets(title: PreparedTitle, directory: string, signal?: AbortSignal) {
  const publicDir = path.join(directory, 'assets');
  await fs.mkdir(publicDir);
  const entries = await Promise.all(
    Object.entries(title.assets).map(async ([key, file], index) => {
      signal?.throwIfAborted();
      // Numeric names remain distinct on case-insensitive filesystems and never include asset keys.
      const staged = `asset-${index}${path.extname(file).toLowerCase()}`;
      const target = path.join(publicDir, staged);
      await fs.copyFile(file, target);
      // Remotion embeds public file mtimes in index.html; make snapshot metadata reproducible.
      await fs.utimes(target, 0, 0);

      return { key, staged, hash: (await hashFile(target)).digest('hex') };
    })
  );

  return {
    publicDir,
    inputProps: { ...title.props, ...Object.fromEntries(entries.map((asset) => [asset.key, asset.staged])) },
    assetHashes: Object.fromEntries(entries.map((asset) => [asset.key, asset.hash])),
  };
}

async function browserIdentity(remotion: RemotionModules, config: McpConfig, signal?: AbortSignal) {
  const setup = config.browserExecutable ? undefined : ((await remotion.ensureBrowser()) as { path?: string });
  const browserExecutable = config.browserExecutable ?? setup?.path;

  if (!browserExecutable) throw new Error('effect_browser_unavailable: browser setup returned no executable path.');
  const version = await new Promise<string>((resolve, reject) => {
    execFile(
      browserExecutable,
      ['--version'],
      { timeout: Math.min(config.renderTimeoutMs, SETUP_TIMEOUT_MS), signal, maxBuffer: 65536 },
      (error, stdout) => {
        if (error) {
          reject(new Error(error.message));

          return;
        }
        resolve(stdout.trim());
      }
    );
  });

  if (!version) throw new Error('effect_browser_unavailable: browser version could not be determined.');

  return { browserExecutable, browserVersion: version };
}

function assertComposition(composition: TitleJob['composition']) {
  if (
    composition.width !== 1280 ||
    composition.height !== 720 ||
    composition.fps !== 30 ||
    composition.durationInFrames !== 300
  ) {
    throw new Error('effect_metadata_mismatch: Registered effects must render 1280x720 at 30 fps for 300 frames.');
  }
}

async function bundleJob(
  title: PreparedTitle,
  config: McpConfig,
  remotion: RemotionModules,
  directory: string,
  signal?: AbortSignal
): Promise<TitleJob> {
  // Preflight metadata survives IPC. Legacy builtin callers may omit both fields;
  // this fallback uses the static builtin registry, never the operator catalog.
  const definition =
    title.compositionId === undefined && title.definitionHash === undefined
      ? getEffectDefinition(title.section.effect.id, title.section.effect.version)
      : title;
  const { compositionId, definitionHash } = definition;

  if (
    typeof compositionId !== 'string' ||
    !/^[A-Za-z0-9-]+$/.test(compositionId) ||
    typeof definitionHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(definitionHash)
  ) {
    throw new Error('effect_metadata_invalid: prepared compositionId and definitionHash are required.');
  }
  const { publicDir, inputProps, assetHashes } = await snapshotAssets(title, directory, signal);
  const options = await remotionBundleOptions(config.remotionEntry as string);
  const serveUrl = await remotion.bundle({ ...options, publicDir, outDir: path.join(directory, 'bundle') });
  const browser = await browserIdentity(remotion, config, signal);
  const composition = await remotion.selectComposition({
    serveUrl,
    id: compositionId,
    inputProps,
    browserExecutable: browser.browserExecutable,
    timeoutInMilliseconds: config.renderTimeoutMs,
  });
  assertComposition(composition);
  const sourceHash = await hashFiles(serveUrl);
  const require = createRequire(import.meta.url);
  const renderer = {
    version: String(require('@remotion/renderer/package.json').version),
    codec: 'h264',
    imageFormat: 'png',
    ...browser,
    timeoutMs: config.renderTimeoutMs,
    concurrency: 1,
  };
  const provenance = {
    hash: templateRevision({
      id: title.section.effect.id,
      version: title.section.effect.version,
      compositionId,
      definitionHash,
      sourceHash,
      assetHashes,
      inputProps,
      renderer,
      composition,
    }),
    effectId: title.section.effect.id,
    effectVersion: title.section.effect.version,
    compositionId,
    definitionHash,
    sourceHash,
    assetHashes,
    renderer,
  };
  await fs.writeFile(
    path.join(directory, 'provenance.json'),
    JSON.stringify({ provenance, inputProps, composition }, null, 2)
  );

  return Object.freeze({
    directory,
    serveUrl,
    inputProps: Object.freeze(inputProps),
    composition: Object.freeze(composition),
    provenance,
    remotion,
    config: Object.freeze({ ...config, browserExecutable: browser.browserExecutable }),
    signal,
  });
}

/** Bundling/setup run only inside the deadline-controlled worker in production. */
export async function prepareTitleJob(
  title: PreparedTitle,
  config: McpConfig,
  signal?: AbortSignal,
  allocatedDirectory?: string
): Promise<TitleJob> {
  signal?.throwIfAborted();

  if (!config.allowRemotion || !config.remotionEntry) {
    throw new Error('effect_backend_unavailable: configure allowRemotion and a trusted remotionEntry.');
  }
  const remotion = await loadRemotion();

  if ('error' in remotion) throw new Error(remotion.error);
  const base = path.join(config.mediaDir, '.leclap-effects');
  await fs.mkdir(base, { recursive: true });
  await assertWithinMediaDir(base, config.mediaDir);
  const directory = allocatedDirectory ?? (await fs.mkdtemp(path.join(base, 'job-')));

  try {
    return await bundleJob(title, config, remotion, directory, signal);
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});

    throw error;
  }
}

function assertRequest(request: TitleRender) {
  if (request.kind === 'still') {
    if (!Number.isInteger(request.frame) || request.frame < 0 || request.frame > 299) {
      throw new Error('preview_frame_invalid: expected frame 0..299.');
    }

    return;
  }

  if (
    request.kind === 'range' &&
    (!Number.isInteger(request.from) ||
      !Number.isInteger(request.to) ||
      request.from < 0 ||
      request.to > 299 ||
      request.to < request.from ||
      request.to - request.from + 1 > 90)
  ) {
    throw new Error('preview_range_invalid: expected up to 90 frames within 0..299.');
  }
}

function durationFor(request: TitleRender): number {
  if (request.kind === 'range') return (request.to - request.from + 1) / 30;

  return request.kind === 'still' ? 1 / 30 : 10;
}

function render(job: TitleJob, request: TitleRender, output: string, cancelSignal: unknown) {
  const common = {
    serveUrl: job.serveUrl,
    composition: job.composition,
    inputProps: job.inputProps,
    browserExecutable: job.config.browserExecutable,
    cancelSignal,
    timeoutInMilliseconds: job.config.renderTimeoutMs,
  };

  if (request.kind === 'still') {
    return job.remotion.renderStill({ ...common, frame: request.frame, imageFormat: 'png', output });
  }

  return job.remotion.renderMedia({
    ...common,
    codec: 'h264',
    outputLocation: output,
    concurrency: 1,
    ...(request.kind === 'range' ? { frameRange: [request.from, request.to] } : {}),
  });
}

/** Preview and final clips use the same immutable source snapshot and composition. */
export async function renderTitleJob(job: TitleJob, request: TitleRender): Promise<EffectRenderResult> {
  job.signal?.throwIfAborted();
  assertRequest(request);
  const output = path.join(
    job.directory,
    `${request.kind}-${randomUUID()}.${request.kind === 'still' ? 'png' : 'mp4'}`
  );
  const { cancelSignal, cancel } = job.remotion.makeCancelSignal();
  job.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, job.config.renderTimeoutMs);

  try {
    await render(job, request, output, cancelSignal);

    return {
      path: output,
      metadata: { duration: durationFor(request), width: 1280, height: 720, fps: 30 },
      provenance: job.provenance,
    };
  } catch (error) {
    cancel();
    await fs.rm(output, { force: true }).catch(() => {});

    throw error;
  } finally {
    clearTimeout(timer);
    job.signal?.removeEventListener('abort', cancel);
  }
}
