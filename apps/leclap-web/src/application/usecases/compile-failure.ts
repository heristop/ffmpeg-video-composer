// Why a render produced no video, as a stable kind the interface can put in the viewer's language: the
// engine only speaks English stderr. `detail` carries the engine's own first line, verbatim, only when the
// kind can't say anything more specific; the whole error (stderr included) is logged, and kept as the
// thrown CompileError's cause.
export type CompileFailureKind =
  | 'missingClip'
  | 'unreadableClip'
  | 'assemblyFailed'
  | 'engineUnavailable'
  | 'appUpdated'
  | 'stopped'
  | 'unknown';

export interface CompileFailure {
  kind: CompileFailureKind;
  /** The engine's first line, for a failure the app has no words of its own for. Empty otherwise. */
  detail: string;
}

// The engine never got its ffmpeg.wasm core (offline on first use, say): the load failed, or the engine gave
// up waiting for it.
const ENGINE_UNAVAILABLE = /Failed to initialize FFmpeg WebAssembly|Timeout waiting for FFmpeg WebAssembly to load/i;
// A deploy replaced the code chunks this tab was built against: the render's lazily loaded engine chunk is
// gone (the host answers with its HTML page). A reload picks up the new build; nothing is wrong with the template.
const APP_UPDATED =
  /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i;
// A clip FFmpeg couldn't open once it was staged into the WASM filesystem: missing, damaged, or in a
// container this build can't demux.
const UNREADABLE_CLIP =
  /moov atom not found|Invalid data found|detected only with low score|does not contain any stream/i;
// The engine ran but had nothing to hand back, or lost a file of its own on the way.
const ASSEMBLY_FAILED = /no output produced|no output generated|No such file/i;
const MAX_DETAIL = 200;

// The error a render rejects with: an English message for the logs, the failure for the interface.
export class CompileError extends Error {
  readonly failure: CompileFailure;

  constructor(failure: CompileFailure, options?: ErrorOptions) {
    super(`Render failed (${failure.kind})${failure.detail ? `: ${failure.detail}` : ''}`, options);
    this.name = 'CompileError';
    this.failure = failure;
  }
}

export const classifyCompileFailure = (error: unknown): CompileFailure => {
  if (error instanceof CompileError) return error.failure;

  const raw = error instanceof Error ? error.message : String(error);

  if (APP_UPDATED.test(raw)) return { kind: 'appUpdated', detail: '' };

  if (ENGINE_UNAVAILABLE.test(raw)) return { kind: 'engineUnavailable', detail: '' };

  if (UNREADABLE_CLIP.test(raw)) return { kind: 'unreadableClip', detail: '' };

  if (ASSEMBLY_FAILED.test(raw)) return { kind: 'assemblyFailed', detail: '' };

  return { kind: 'unknown', detail: raw.split('\n')[0].trim().slice(0, MAX_DETAIL) };
};
