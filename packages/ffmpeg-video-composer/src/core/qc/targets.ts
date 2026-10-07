// The loudness normalisation targets (single-pass loudnorm in editor/MusicComposer.ts), shared with the
// output QC that checks them. A leaf module, so the browser and React Native bundles that normalise
// audio don't pull in the QC verdict.

/** Integrated loudness target, LUFS. */
export const LOUDNORM_INTEGRATED = -16;
/** True-peak ceiling, dBTP. */
export const LOUDNORM_TRUE_PEAK = -1.5;

/** A loudnorm target: integrated loudness (LUFS) and true-peak ceiling (dBTP). */
export interface LoudnessTarget {
  integrated: number;
  truePeak: number;
}
