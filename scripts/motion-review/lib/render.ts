import { execFile } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Engine } from './engine.ts';
import type { ManifestEntry, RenderJob } from './types.ts';

// Run `leclap snapshot` for each job (a small worker pool) and collect the sheet, the frames and the
// timing into manifest entries. A failing job is recorded, never fatal: the index shows the error.

const execFileAsync = promisify(execFile);

export interface RenderContext {
  engine: Engine;
  stage: string;
  /** Output root; sheets land in `<out>/<label>/sheets`, frames in `<out>/<label>/frames/<key>`. */
  out: string;
  label: string;
  cacheDir: string;
}

interface SnapshotJson {
  ok?: boolean;
  error?: string;
  frames?: { path: string }[];
  sheets?: { path: string }[];
}

function snapshotArgs(job: RenderJob, ctx: RenderContext, descriptorFile: string, framesDir: string): string[] {
  return [
    ctx.engine.cli,
    'snapshot',
    descriptorFile,
    '--at',
    job.at.join(','),
    '--sheet',
    '3x2',
    '--assets',
    ctx.stage,
    '--cache',
    path.join(ctx.cacheDir, 'section-cache'),
    '--out',
    framesDir,
    '--json',
    ...job.args,
  ];
}

function parseResult(stdout: string): SnapshotJson {
  const line = stdout
    .split('\n')
    .map((text) => text.trim())
    .findLast((text) => text.startsWith('{'));

  return line ? (JSON.parse(line) as SnapshotJson) : { ok: false, error: 'no JSON result from the CLI' };
}

function base(job: RenderJob): Omit<ManifestEntry, 'status' | 'ms'> {
  return { key: job.key, group: job.group, title: job.title, kind: job.kind, frames: [], notes: job.notes };
}

function errorText(error: unknown): string {
  const stdout = (error as { stdout?: string }).stdout ?? '';
  const parsed = stdout ? parseResult(stdout) : {};

  return parsed.error ?? (error instanceof Error ? error.message : String(error)).split('\n')[0];
}

async function renderJob(job: RenderJob, ctx: RenderContext): Promise<ManifestEntry> {
  if (job.skip) return { ...base(job), status: 'skipped', error: job.skip, ms: 0 };

  const runDir = path.join(ctx.out, ctx.label);
  const framesDir = path.join(runDir, 'frames', job.key);
  const descriptorFile = path.join(runDir, 'descriptors', `${job.key}.json`);
  const started = performance.now();

  rmSync(framesDir, { recursive: true, force: true });
  writeFileSync(descriptorFile, `${JSON.stringify(job.descriptor, null, 2)}\n`);

  try {
    const { stdout } = await execFileAsync('node', snapshotArgs(job, ctx, descriptorFile, framesDir), {
      maxBuffer: 64 * 1024 * 1024,
    });

    return collect(job, ctx, parseResult(stdout), performance.now() - started);
  } catch (error) {
    return { ...base(job), status: 'failed', error: errorText(error), ms: Math.round(performance.now() - started) };
  }
}

function collect(job: RenderJob, ctx: RenderContext, result: SnapshotJson, ms: number): ManifestEntry {
  const sheetSource = result.sheets?.at(0)?.path;

  if (result.ok === false || !sheetSource) {
    return { ...base(job), status: 'failed', error: result.error ?? 'no sheet written', ms: Math.round(ms) };
  }

  const sheet = path.join(ctx.label, 'sheets', `${job.key}.png`);

  copyFileSync(sheetSource, path.join(ctx.out, sheet));

  return {
    ...base(job),
    status: 'ok',
    sheet,
    frames: (result.frames ?? []).map((frame) => path.relative(ctx.out, frame.path)),
    ms: Math.round(ms),
  };
}

/** Render every job with `concurrency` workers, reporting each as it finishes. */
export async function renderAll(jobs: RenderJob[], ctx: RenderContext, concurrency: number): Promise<ManifestEntry[]> {
  const runDir = path.join(ctx.out, ctx.label);
  const results: ManifestEntry[] = Array.from({ length: jobs.length });
  let next = 0;

  for (const dir of ['sheets', 'frames', 'descriptors']) mkdirSync(path.join(runDir, dir), { recursive: true });

  // Each worker takes the next job, renders it, then recurses: the pool bounds how many renders overlap.
  async function worker(): Promise<void> {
    const index = next;

    if (index >= jobs.length) return;

    next += 1;
    results[index] = await renderJob(jobs[index], ctx);
    process.stdout.write(`  ${results[index].status.padEnd(7)} ${jobs[index].key} (${results[index].ms} ms)\n`);
    await worker();
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()));

  return results;
}
