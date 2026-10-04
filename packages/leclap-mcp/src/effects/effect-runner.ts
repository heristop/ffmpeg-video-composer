import { terminateEffectProcess, type OwnedEffectProcess } from './effect-processes.js';
import { acquireEffectJobPermit } from './effect-job-budget.js';
import { fork } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EffectRenderResult } from 'ffmpeg-video-composer';
import type { McpConfig } from '../config.js';
import { assertWithinMediaDir } from '../compose/pathGuard.js';
import type { PreparedTitle } from './title-registry.js';
import type { TitleRender, TitleJob } from './registered-render.js';

export interface EffectCacheSummary {
  hits: number;
  misses: number;
  writes: number;
}

export interface TitleWorkerResult {
  cache?: EffectCacheSummary;
  directory: string;
  results: EffectRenderResult[];
  provenance: TitleJob['provenance'];
}

// Job directories hold preview PNG/MP4 files that callers link to after the call returns, so they
// cannot be removed on success. Each new job instead sweeps job directories older than this window,
// which bounds disk use without breaking links returned by recent calls.
const JOB_RETENTION_MS = 60 * 60 * 1000;

async function sweepStaleJobs(base: string, now = Date.now()) {
  const entries = await fs.readdir(base, { withFileTypes: true });

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('job-'))
      .map(async (entry) => {
        const target = path.join(base, entry.name);
        const { mtimeMs } = await fs.lstat(target);

        if (now - mtimeMs > JOB_RETENTION_MS) {
          await fs.rm(target, { recursive: true, force: true });
        }
      })
  );
}

/** Queue wait and worker setup/render each have a separate renderTimeoutMs deadline. */
export async function runTitleEffect(
  title: PreparedTitle,
  config: McpConfig,
  requests: TitleRender[],
  signal?: AbortSignal
): Promise<TitleWorkerResult> {
  signal?.throwIfAborted();
  const release = await acquireEffectJobPermit(config.renderTimeoutMs, signal);
  let directory: string | undefined;

  try {
    signal?.throwIfAborted();
    // Canonicalize once here: the cache compares realpaths, so a symlinked media dir (macOS /tmp)
    // must not leave job directories under an unresolved prefix.
    const media = await fs.realpath(config.mediaDir);
    const base = path.join(media, '.leclap-effects');
    await fs.mkdir(base, { recursive: true });
    await assertWithinMediaDir(base, media);
    await sweepStaleJobs(base);
    directory = await fs.mkdtemp(path.join(base, 'job-'));

    try {
      return await executeTitleWorker(title, config, requests, directory, signal);
    } catch (error) {
      if (directory) await fs.rm(directory, { recursive: true, force: true });

      throw error;
    }
  } finally {
    release();
  }
}

function workerTermination(child: ReturnType<typeof fork>, ownedProcesses: Map<number, OwnedEffectProcess>) {
  let hardKilled = false;

  return (sig: NodeJS.Signals) => {
    if (sig === 'SIGKILL' && hardKilled) return;

    if (sig === 'SIGKILL') hardKilled = true;

    for (const owned of ownedProcesses.values()) terminateEffectProcess(owned, sig);

    if (process.platform === 'win32' && child.pid) {
      terminateEffectProcess({ pid: child.pid, detached: false }, sig);
      child.kill(sig);

      return;
    }

    try {
      if (process.platform !== 'win32' && child.pid) {
        process.kill(-child.pid, sig);

        return;
      }
      child.kill(sig);
    } catch {
      child.kill(sig);
    }
  };
}

function validOwnedProcess(
  owned: OwnedEffectProcess | undefined,
  workerPid: number | undefined
): owned is OwnedEffectProcess {
  return Boolean(
    owned &&
    Number.isSafeInteger(owned.pid) &&
    owned.pid > 0 &&
    owned.pid !== process.pid &&
    owned.pid !== workerPid &&
    typeof owned.detached === 'boolean'
  );
}

function executeTitleWorker(
  title: PreparedTitle,
  config: McpConfig,
  requests: TitleRender[],
  directory: string,
  signal?: AbortSignal
): Promise<TitleWorkerResult> {
  return new Promise<TitleWorkerResult>((resolve, reject) => {
    const child = fork(fileURLToPath(new URL('./effect-worker.js', import.meta.url)), [], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      detached: process.platform !== 'win32',
    });
    child.stderr?.resume();
    let failure: Error | undefined;
    let result: TitleWorkerResult | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const ownedProcesses = new Map<number, OwnedEffectProcess>();
    const kill = workerTermination(child, ownedProcesses);
    function stop(error: Error) {
      if (failure) return;
      failure = error;

      if (child.connected) child.send({ cancel: true }, () => {});
      kill('SIGTERM');
      killTimer = setTimeout(() => {
        kill('SIGKILL');
      }, 1000);
    }
    function abort() {
      stop(new Error('Effect rendering aborted'));
    }
    const timer = setTimeout(() => {
      stop(new Error(`Effect rendering timed out after ${config.renderTimeoutMs}ms`));
    }, config.renderTimeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    child.on('message', (message: unknown) => {
      const reply = message as {
        ownedProcess?: OwnedEffectProcess;
        ok?: boolean;
        results?: EffectRenderResult[];
        provenance?: TitleJob['provenance'];
        cache?: EffectCacheSummary;
        error?: string;
      };

      const owned = reply.ownedProcess;

      if (validOwnedProcess(owned, child.pid)) {
        ownedProcesses.set(owned.pid, owned);

        if (failure) terminateEffectProcess(owned, 'SIGKILL');

        return;
      }

      if (reply.ok && reply.results && reply.provenance) {
        result = {
          directory,
          results: reply.results,
          provenance: reply.provenance,
          cache: reply.cache ?? { hits: 0, misses: 0, writes: 0 },
        };

        return;
      }
      stop(new Error(reply.error ?? 'Effect worker returned an invalid response'));
    });
    child.once('error', (error) => {
      if (child.pid) {
        stop(error);

        return;
      }
      {
        clearTimeout(timer);
        clearTimeout(killTimer);
        signal?.removeEventListener('abort', abort);
        reject(error);
      }
    });
    child.once('exit', (code) => {
      // The worker may exit on cancellation before Chromium children do.
      if (failure) kill('SIGKILL');

      for (const owned of ownedProcesses.values()) terminateEffectProcess(owned, 'SIGKILL');
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener('abort', abort);

      if (!failure && code === 0 && result) {
        resolve(result);

        return;
      }
      reject(failure ?? new Error(`Effect worker exited without a result (${code})`));
    });
    const { effectCatalog: _catalog, effectCatalogPath: _catalogPath, ...workerConfig } = config;
    child.send({ title, config: workerConfig, requests, directory }, (error) => {
      if (error) stop(error);
    });

    if (signal?.aborted) abort();
  });
}
