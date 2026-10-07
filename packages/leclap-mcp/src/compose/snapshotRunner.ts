import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { SnapshotJob, SnapshotOutcome } from '../worker/snapshot-job.js';
import {
  executeJob,
  failureResult,
  forkWorker,
  inSlot,
  workerGone,
  type RenderOptions,
  type WorkerFailure,
  type WorkerMessage,
} from './renderRunner.js';

export type SnapshotRunResult = { ok: true; snapshot: SnapshotOutcome } | WorkerFailure;

/** Read a snapshot job's terminal message; a success without frames is a failure. Exported for unit test. */
export function snapshotRunResult(msg: WorkerMessage, logTail: string): SnapshotRunResult {
  if (msg.ok && msg.snapshot) {
    return { ok: true, snapshot: msg.snapshot };
  }

  return msg.ok ? { ok: false, error: 'render worker returned no frames', logTail } : failureResult(msg, logTail);
}

// `render_frames`: snapshots in their own worker, under the same slot cap, timeout and cancellation as a
// compose. As with the geometry check, this process owns the scratch folder the worker renders in, and
// removes it once the worker is gone (a killed worker never cleans up after itself).
export function runSnapshot(job: SnapshotJob, opts: RenderOptions): Promise<SnapshotRunResult> {
  return inSlot(opts, async () => {
    const scratch = await fs.mkdtemp(path.join(job.options.workDir ?? os.tmpdir(), 'leclap-frames-'));
    const child = forkWorker();
    const gone = workerGone(child);
    const scoped = { ...job, options: { ...job.options, workDir: scratch } } as SnapshotJob;

    try {
      return await executeJob(scoped, opts, snapshotRunResult, child);
    } finally {
      await gone;
      await fs.rm(scratch, { recursive: true, force: true });
    }
  });
}
