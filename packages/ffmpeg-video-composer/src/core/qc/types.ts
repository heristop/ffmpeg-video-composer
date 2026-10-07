// Output QC (`verified`): what a render is expected to be, what was measured on the file, and the
// findings that compare the two. Pure types, shared by every entry point; the measurement itself is
// Node-only (services/qc-node.ts).

export type QcStatus = 'pass' | 'warn' | 'fail';

/**
 * `format` findings are objective container/stream properties (duration, frame count, A/V drift, pixel
 * format, colour tags, audio presence): they decide `verified`. `judgement` findings (black, frozen or
 * silent stretches, loudness) describe content a template may want on purpose, so they only inform.
 */
export type QcKind = 'format' | 'judgement';

export interface QcFinding {
  check: string;
  status: QcStatus;
  value: string | number | null;
  expected: string | number | null;
  reason: string;
  kind: QcKind;
}

export interface QcReport {
  /** Every `format` finding passed. */
  verified: boolean;
  /** Whether the content pass (black/freeze/silence/loudness) was requested. */
  content: boolean;
  findings: QcFinding[];
}

/** What the plan says the output should be, captured by the director before the build state resets. */
export interface QcExpectations {
  /** Sum of the rendered section lengths minus the transition overlaps, in seconds. */
  durationSeconds: number;
  fps: number;
  /** Music is mixed in, or a clip brings its own sound. */
  audioExpected: boolean;
  normalize: 'loudnorm' | 'dynaudnorm' | null;
  /** The loudnorm target (the delivery platform's when set); absent means the engine default. */
  loudnessTarget?: { integrated: number; truePeak: number };
}

export interface QcVideoProbe {
  duration: number | null;
  frames: number | null;
  pixFmt: string | null;
  colorSpace: string | null;
  colorPrimaries: string | null;
  colorTransfer: string | null;
}

export interface QcStreamProbe {
  video: QcVideoProbe | null;
  audio: { duration: number | null } | null;
  formatDuration: number | null;
}

export interface QcInterval {
  start: number;
  end: number;
}

export interface QcContentMeasure {
  black: QcInterval[];
  freeze: QcInterval[];
  silence: QcInterval[];
  /** Integrated loudness in LUFS; null when there is no audio track. */
  integrated: number | null;
  /** True peak in dBTP (`-Infinity` for digital silence); null when there is no audio track. */
  truePeak: number | null;
}

/** The loudness normalisation actually applied (editor/utils/true-peak-guard.ts). */
export interface LoudnessReport {
  filter: 'loudnorm';
  /** Requested true-peak ceiling, dBTP. */
  target: number;
  /** Ceiling passed to loudnorm on the last pass, dBTP. */
  ceiling: number;
  /** True peak measured on the encoded file after the last pass; null when it could not be measured. */
  measured: number | null;
  retries: number;
  /** Every pass in order: the ceiling it used and the true peak measured on its encoded output. */
  attempts: Array<{ ceiling: number; measured: number | null }>;
}

export interface QcMeasurements {
  /** null when the stream probe failed or no ffprobe is available (see `probeError`). */
  probe: QcStreamProbe | null;
  probeError?: string;
  /** undefined when the content pass was not requested; null when it ran and failed (see `contentError`). */
  content?: QcContentMeasure | null;
  contentError?: string;
  loudness?: LoudnessReport | null;
}

/** Shape of `ProjectConfig.qc`. */
export type QcOption = boolean | { content?: boolean };
