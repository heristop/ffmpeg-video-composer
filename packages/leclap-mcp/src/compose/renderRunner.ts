import { fork, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ProjectConfig, QcReport, RenderedGeometry, TemplateDescriptor } from 'ffmpeg-video-composer';

import type { GeometryJob } from '../worker/geometry-job.js';
import type { SnapshotJob, SnapshotOutcome as SnapshotJobOutcome } from '../worker/snapshot-job.js';
import type { ProgressMessage } from '../worker/progress-reporter.js';

// One render job, shipped to the forked worker over IPC.
export interface RenderJob {
  projectConfig: ProjectConfig;
  template: TemplateDescriptor;
}

// The worker's success payload includes ffmpeg metadata under `infos`; the runner flattens the
// fields it surfaces so callers don't depend on the core's FFMpegInfos shape.
interface WorkerInfos {
  duration: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
}

export interface WorkerMessage {
  ok: boolean;
  outputPath?: string;
  infos?: WorkerInfos;
  sizeBytes?: number;
  // The engine's output QC report, when the job's ProjectConfig asked for one.
  qc?: QcReport;
  // A geometry job's result (worker/geometry-job.ts) in place of the render fields.
  geometry?: RenderedGeometry;
  // A snapshot job's frames and sheets (worker/snapshot-job.ts).
  snapshot?: SnapshotJobOutcome;
  error?: string;
}

export type WorkerFailure = { ok: false; error: string; logTail?: string };

export type RenderResult =
  | {
      ok: true;
      outputPath: string;
      durationSeconds: number | null;
      sizeBytes: number;
      videoCodec: string | null;
      audioCodec: string | null;
      qc?: QcReport;
    }
  | WorkerFailure;

export type GeometryCheckResult = { ok: true; geometry: RenderedGeometry } | WorkerFailure;

export interface RenderOptions {
  timeoutMs: number;
  // Aborts when the MCP client cancels the tool call; kills the worker and frees its slot at once
  // instead of holding it for the full timeout.
  signal?: AbortSignal;
  // Called with the 0..1 compilation fraction each time the worker reports one. Advisory only: a
  // progress ping must never settle the render or clear its guards.
  onProgress?: (fraction: number) => void;
}

type InboundMessage = WorkerMessage | ProgressMessage;

interface MessageHandlers {
  onProgress?: (fraction: number) => void;
  onResult: (message: WorkerMessage) => void;
}

// `WorkerMessage` has no `kind` field at all, so its presence alone is the discriminator.
function isProgress(message: InboundMessage): message is ProgressMessage {
  return 'kind' in message;
}

/**
 * Split the IPC stream in two. Progress pings are advisory and recur; exactly one terminal result
 * message ever arrives, and only that one may settle the render. Exported for unit test — the fork
 * itself is exercised by the compose-video suite.
 */
export function routeWorkerMessage(message: InboundMessage, handlers: MessageHandlers): void {
  if (isProgress(message)) {
    handlers.onProgress?.(message.fraction);

    return;
  }

  handlers.onResult(message);
}

const GRACE_MS = 5_000;
const RING_LIMIT = 16 * 1024;

// Each render forks a worker that runs a fully-threaded ffmpeg, so a handful of parallel renders
// already saturates the host. Cap concurrent workers (leaving headroom) and queue the rest, so a
// burst of compose_video calls can't exhaust CPU/memory/file descriptors.
const MAX_CONCURRENT_RENDERS = Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2)));

// Minimal FIFO async semaphore: acquire() resolves when a slot is free, release() hands the slot to
// the next waiter (or frees it). `active` counts occupied slots; a queued waiter inherits a slot on
// release without a decrement, so the count never drifts.
class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active += 1;

      return Promise.resolve();
    }

    return new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();

    if (next) {
      next();

      return;
    }

    this.active -= 1;
  }
}

const renderSemaphore = new Semaphore(MAX_CONCURRENT_RENDERS);

// dist/render-worker.js sits beside the bundled dist/index.js this runner is compiled into, so
// resolve it relative to the runner's own module URL at runtime (works regardless of cwd).
function workerPath(): string {
  return fileURLToPath(new URL('./render-worker.js', import.meta.url));
}

// Capped tail buffer: keeps the last ~16 KB of the child's stdout+stderr for error reporting,
// so a chatty render can't grow memory without bound.
class RingBuffer {
  private readonly chunks: string[] = [];
  private size = 0;

  append(text: string): void {
    this.chunks.push(text);
    this.size += text.length;

    while (this.size > RING_LIMIT && this.chunks.length > 1) {
      const dropped = this.chunks.shift() ?? '';
      this.size -= dropped.length;
    }
  }

  toString(): string {
    return this.chunks.join('').slice(-RING_LIMIT);
  }
}

function captureStreams(child: ChildProcess, ring: RingBuffer): void {
  child.stdout?.on('data', (data: Buffer) => {
    ring.append(data.toString('utf8'));
  });
  child.stderr?.on('data', (data: Buffer) => {
    ring.append(data.toString('utf8'));
  });
}

// Lead the failure message with the most relevant line the core logged, when present.
function leadLine(logTail: string): string | undefined {
  const lines = logTail.split('\n');
  const hit = lines.find((line) => line.includes('Compilation error:') || line.includes('FFmpeg command failed'));

  return hit?.trim();
}

function successResult(msg: WorkerMessage): RenderResult {
  return {
    ok: true,
    outputPath: msg.outputPath ?? '',
    durationSeconds: msg.infos?.duration ?? null,
    sizeBytes: msg.sizeBytes ?? 0,
    videoCodec: msg.infos?.videoCodec ?? null,
    audioCodec: msg.infos?.audioCodec ?? null,
    ...(msg.qc && { qc: msg.qc }),
  };
}

export function failureResult(msg: WorkerMessage, logTail: string): WorkerFailure {
  const lead = leadLine(logTail);
  const base = msg.error ?? lead ?? 'compilation failed';

  return { ok: false, error: base, logTail };
}

function renderResult(msg: WorkerMessage, logTail: string): RenderResult {
  return msg.ok ? successResult(msg) : failureResult(msg, logTail);
}

/**
 * Read a geometry job's terminal message. A success that somehow carries no geometry is a failure, so
 * the caller falls back to its static findings rather than reporting an empty render. Exported for
 * unit test.
 */
export function geometryCheckResult(msg: WorkerMessage, logTail: string): GeometryCheckResult {
  if (msg.ok && msg.geometry) {
    return { ok: true, geometry: msg.geometry };
  }

  if (msg.ok) {
    return { ok: false, error: 'render worker returned no geometry', logTail };
  }

  return failureResult(msg, logTail);
}

// Force the child down: SIGTERM first, then SIGKILL after a short grace if it is still alive.
function killChild(child: ChildProcess): void {
  child.kill('SIGTERM');
  const grace = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }, GRACE_MS);
  grace.unref();
}

// Per-render state shared between the event handlers, so each handler stays tiny and the
// resolve-once guard lives in one place.
interface RunState<T> {
  child: ChildProcess;
  ring: RingBuffer;
  settled: boolean;
  resolve: (result: T | WorkerFailure) => void;
}

// How a job kind reads its worker's terminal message.
type Interpret<T> = (msg: WorkerMessage, logTail: string) => T | WorkerFailure;

function settle<T>(state: RunState<T>, result: T | WorkerFailure): void {
  if (state.settled) {
    return;
  }

  state.settled = true;
  state.resolve(result);
}

function onMessage<T>(state: RunState<T>, msg: WorkerMessage, interpret: Interpret<T>): void {
  settle(state, interpret(msg, state.ring.toString()));
}

function onExit<T>(state: RunState<T>, code: number | null): void {
  settle(state, {
    ok: false,
    error: `render worker exited (code ${code ?? 'unknown'})`,
    logTail: state.ring.toString(),
  });
}

// A fork() that never spawns (missing worker bundle, EMFILE, ENOMEM) or a send() over a closed
// channel emits 'error'. Without a listener Node throws it as an uncaught exception, which would
// crash the whole stdio server instead of failing just this render.
function onError<T>(state: RunState<T>, error: Error): void {
  settle(state, {
    ok: false,
    error: `render worker failed: ${error.message}`,
    logTail: state.ring.toString(),
  });
}

function onTimeout<T>(state: RunState<T>, timeoutMs: number): void {
  killChild(state.child);
  settle(state, {
    ok: false,
    error: `render timed out after ${timeoutMs}ms`,
    logTail: state.ring.toString(),
  });
}

export function forkWorker(): ChildProcess {
  return fork(workerPath(), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
}

// Resolves once the worker process is gone: it exited (on its own, or killed on timeout/cancel), or it
// never spawned at all, in which case 'error' is all it will ever emit.
export function workerGone(child: ChildProcess): Promise<void> {
  return new Promise<void>((resolve) => {
    child.once('exit', () => {
      resolve();
    });
    child.on('error', () => {
      if (child.pid === undefined) {
        resolve();
      }
    });
  });
}

export function executeJob<T>(
  job: RenderJob | GeometryJob | SnapshotJob,
  opts: RenderOptions,
  interpret: Interpret<T>,
  child: ChildProcess = forkWorker()
): Promise<T | WorkerFailure> {
  return new Promise<T | WorkerFailure>((resolve) => {
    const ring = new RingBuffer();
    const state: RunState<T> = { child, ring, settled: false, resolve };

    captureStreams(child, ring);

    const timer = setTimeout(() => {
      onTimeout(state, opts.timeoutMs);
    }, opts.timeoutMs);
    timer.unref();

    function onAbort(): void {
      killChild(child);
      settle(state, { ok: false, error: 'render cancelled', logTail: state.ring.toString() });
    }

    // Cleared once, whichever handler settles first, so the timer and the abort listener never
    // outlive the render.
    function clearGuards(): void {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }

    child.on('message', (msg: InboundMessage) => {
      routeWorkerMessage(msg, {
        onProgress: opts.onProgress,
        onResult: (result) => {
          clearGuards();
          onMessage(state, result, interpret);
        },
      });
    });

    child.on('exit', (code) => {
      clearGuards();
      onExit(state, code);
    });

    child.on('error', (error) => {
      clearGuards();
      onError(state, error);
    });

    opts.signal?.addEventListener('abort', () => {
      clearGuards();
      onAbort();
    });

    child.send(job, (error) => {
      if (!error) {
        return;
      }

      clearGuards();
      onError(state, error);
    });
  });
}

// Bound how many worker forks run at once; queued calls wait for a free slot before forking. If the
// call was already cancelled while queued, skip the fork entirely.
export async function inSlot<T>(
  opts: RenderOptions,
  run: () => Promise<T | WorkerFailure>
): Promise<T | WorkerFailure> {
  await renderSemaphore.acquire();

  try {
    if (opts.signal?.aborted) {
      return { ok: false, error: 'render cancelled' };
    }

    return await run();
  } finally {
    renderSemaphore.release();
  }
}

export function runRender(job: RenderJob, opts: RenderOptions): Promise<RenderResult> {
  return inSlot(opts, () => executeJob(job, opts, renderResult));
}

// `validate_template` with `render: true`: the rendered geometry check in its own worker, under the
// same slot cap, timeout and cancellation as a compose — it renders the text sections twice, so it
// costs like one.
//
// The worker renders into a scratch folder it removes when it finishes, which it never does when it is
// killed on timeout or cancel, or crashes. So this process owns that folder: it creates it, hands it to
// the worker as its workDir, and removes it once the worker is gone — not merely settled, since a
// killed worker still rendering could write into it again.
export function runGeometryCheck(job: GeometryJob, opts: RenderOptions): Promise<GeometryCheckResult> {
  return inSlot(opts, async () => {
    const scratch = await fs.mkdtemp(path.join(job.options.workDir ?? os.tmpdir(), 'leclap-render-check-'));
    const child = forkWorker();
    const gone = workerGone(child);

    try {
      return await executeJob(
        { ...job, options: { ...job.options, workDir: scratch } },
        opts,
        geometryCheckResult,
        child
      );
    } finally {
      await gone;
      await fs.rm(scratch, { recursive: true, force: true });
    }
  });
}
