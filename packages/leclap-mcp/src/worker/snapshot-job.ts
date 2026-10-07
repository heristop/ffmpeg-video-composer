import {
  compareSnapshots,
  lookSnapshots,
  renderSnapshots,
  type CompareOptions,
  type CompareResult,
  type CompareVariant,
  type SnapshotOptions,
  type SnapshotResult,
  type TemplateDescriptor,
} from 'ffmpeg-video-composer';

// `render_frames`, run in the forked render worker: it renders through the engine's process-wide
// container, so it gets compose_video's slot cap, timeout and cancellation, and a process of its own to
// be killed in.
export type SnapshotJob =
  | { kind: 'snapshot'; mode: 'frames'; template: TemplateDescriptor; options: SnapshotOptions }
  | { kind: 'snapshot'; mode: 'compare'; variants: CompareVariant[]; options: CompareOptions }
  | { kind: 'snapshot'; mode: 'looks'; template: TemplateDescriptor; options: CompareOptions };

/** Frames and sheets in one shape, whichever mode produced them. */
export type SnapshotOutcome = Pick<SnapshotResult, 'frames' | 'sheets'>;

export type SnapshotJobResult = { ok: true; snapshot: SnapshotOutcome } | { ok: false; error: string };

export interface SnapshotEngine {
  frames: (template: TemplateDescriptor, options: SnapshotOptions) => Promise<SnapshotResult>;
  compare: (variants: CompareVariant[], options: CompareOptions) => Promise<CompareResult>;
  looks: (template: TemplateDescriptor, options: CompareOptions) => Promise<CompareResult>;
}

// Read at call time, not import time: a module that loads this one need not provide the snapshot API.
const ENGINE: SnapshotEngine = {
  frames: (template, options) => renderSnapshots(template, options),
  compare: (variants, options) => compareSnapshots(variants, options),
  looks: (template, options) => lookSnapshots(template, options),
};

export function isSnapshotJob(job: unknown): job is SnapshotJob {
  return typeof job === 'object' && job !== null && (job as { kind?: unknown }).kind === 'snapshot';
}

async function run(job: SnapshotJob, engine: SnapshotEngine): Promise<SnapshotOutcome> {
  if (job.mode === 'frames') {
    const result = await engine.frames(job.template, job.options);

    return { frames: result.frames, sheets: result.sheets };
  }

  const result =
    job.mode === 'compare'
      ? await engine.compare(job.variants, job.options)
      : await engine.looks(job.template, job.options);

  return { frames: result.frames, sheets: [result.sheet] };
}

// A bad time, an unknown platform or a failed render is reported as a failed job, not a bare exit.
export async function runSnapshotJob(job: SnapshotJob, engine: SnapshotEngine = ENGINE): Promise<SnapshotJobResult> {
  try {
    return { ok: true, snapshot: await run(job, engine) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
