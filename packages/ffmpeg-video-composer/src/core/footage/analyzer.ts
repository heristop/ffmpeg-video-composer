// The media analysis a footage edit can ask of the host. Only the Node compile installs one (its
// ffmpeg binary runs `silencedetect` and lists its filters, services/footage-analysis-node.ts); the
// browser/WASM core and the on-device engine leave it null, so silence trimming falls back to the
// explicit `options.keep` form and an HDR clip gets the `hdr_source_sdr_pipeline` advisory.

import type { SilenceSpan, TrimSilenceParams } from './keep-ranges';

export interface FootageAnalyzer {
  /** Silences of a file's first audio stream (one decode per file + parameters, cached by digest). */
  silences(file: string, params: Pick<TrimSilenceParams, 'threshold' | 'minSilence'>): Promise<SilenceSpan[]>;
  /** True when this FFmpeg build has every named filter (`ffmpeg -filters`, probed once). */
  hasFilters(names: readonly string[]): Promise<boolean>;
}

/** The filters the HDR→SDR tone-map needs (zimg + tonemap: GPL/host builds, never the device allowlist). */
export const TONEMAP_FILTERS = ['zscale', 'tonemap'] as const;

/** HDR (PQ/HLG) → Rec.709 SDR: linearise, map primaries, Hable tone curve, back to limited-range BT.709. */
export const TONEMAP_CHAIN =
  'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,' +
  'zscale=t=bt709:m=bt709:r=tv,format=yuv420p';
