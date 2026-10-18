import type { RenderManifest } from './determinism/manifest';
import type { QcReport } from './qc/types';

// Optional progress/log sink a host (e.g. the `leclap` CLI) can pass to the Node `compile()` so it can
// render live progress and capture the engine's per-segment/ffmpeg logs, mirroring `compileBrowser`'s
// `onProgress`. `onProgress` receives the 0..1 compilation fraction; `onLog` receives every engine log
// line (all levels) regardless of the Pino stdout level, so the host can tee detail to a file.
export type CompileReporter = {
  onProgress?: (fraction: number) => void;
  onLog?: (line: { level: 'debug' | 'info' | 'warn' | 'error'; message: string }) => void;
  // Called once with the cause when compile() resolves null — e.g. a SectionError naming the section.
  onError?: (error: Error) => void;
  // Node only. When set, compile() builds the render manifest (template/graph/asset/output digests, see
  // core/determinism/manifest.ts) after a successful render and hands it here. Hashing costs one read of
  // the output and inputs, so it only runs when a host asks for it.
  onManifest?: (manifest: RenderManifest) => void;
  // Node only. Called with the output QC report (core/qc) after a successful render when
  // `ProjectConfig.qc` is set; the same report is also recorded in the manifest's `qc` field.
  onQc?: (report: QcReport) => void;
  // Node only. Aborting it cancels the build, as the `task-cancelled` event does: the transcription pass
  // kills its whisper run and no further segment renders; compile() then resolves null.
  signal?: AbortSignal;
};
