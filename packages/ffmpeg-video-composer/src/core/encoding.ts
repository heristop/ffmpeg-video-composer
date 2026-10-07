import type { ProjectConfig } from './types';

/**
 * Pure encoder-argument helpers shared by the per-section SegmentBuilder and the final
 * transition-assembly pass in VideoEditor. Keeping them here (rather than as protected
 * SegmentBuilder methods) lets both paths honour the same hardware/codec constraints
 * without one depending on the other.
 */

/** The video encoder name for this platform — `codecConfig.videoCodec` (h264_mediacodec on device) or `h264`. */
export function resolveVideoCodec(config: ProjectConfig): string {
  // The default ProjectConfig sets videoCodec to '' (empty), so any falsy value must fall back to h264.
  const configured = config.codecConfig?.videoCodec;

  if (configured) {
    return configured;
  }

  return 'h264';
}

/** True when the selected encoder is a hardware one (h264_mediacodec / h264_videotoolbox). */
export function isHardwareCodec(config: ProjectConfig): boolean {
  const codec = resolveVideoCodec(config);

  return codec.includes('mediacodec') || codec.includes('videotoolbox');
}

/**
 * True for the on-device native engine (libopenh264 / mpeg4 / hardware encoders) — a LGPL FFmpeg
 * build with `--disable-gpl`, so GPL-only filters like `eq` are absent. The core remaps those to
 * LGPL equivalents (see FilterManager's eq→lutyuv). The server/web/Node default (`h264`/libx264) is
 * a full GPL-capable build and keeps the original filters.
 */
export function usesLgplEngine(config: ProjectConfig): boolean {
  const codec = resolveVideoCodec(config);

  return codec === 'libopenh264' || codec === 'mpeg4' || isHardwareCodec(config);
}

/** `-pix_fmt yuv420p` for software encoders; empty for hardware (the filtergraph sets the format). */
export function buildPixFmtArg(config: ProjectConfig): string {
  return isHardwareCodec(config) ? '' : '-pix_fmt yuv420p';
}

/**
 * Rec.709 limited-range colour-metadata **output flags** for re-encoded output. They set the encoder's
 * matrix + range, the two fields that actually decide how a browser converts YUV→RGB; a source tagged
 * `bt470bg`/full-range (`yuvj420p`) otherwise decodes frozen or wrong-coloured in real Chrome (the
 * malformed-tag decode bug). Appended on the **re-encode** paths (segment encodes + the final
 * transition/animation passes) — never the stream-copy concat, which inherits the tagged segments.
 *
 * Output flags alone do **not** rewrite a source's `color_primaries`/`color_trc` (those leak through
 * from the input frames), so they are a floor; `buildColorMetadataFilter` does the full override.
 */
export function buildColorMetadataArgs(config?: ProjectConfig, ffmpegVersion?: string | null): string {
  if (config && usesX264(config) && ffmpegAtLeast(ffmpegVersion, 7, 1)) {
    return X264_COLOR_PARAMS;
  }

  return '-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv';
}

/**
 * The same Rec.709/limited-range tags written by libx264 itself, into the bitstream VUI. From FFmpeg 7.1
 * the `-colorspace`/`-color_*` output options take part in filtergraph format negotiation, so on a
 * source tagged differently (or untagged) they insert a real matrix/range conversion instead of only
 * tagging. The encoder-level tags never touch pixels; `buildColorMetadataFilter` still tags the frames,
 * which is what the muxer's `colr` box is written from.
 */
export const X264_COLOR_PARAMS = '-x264-params colorprim=bt709:transfer=bt709:colormatrix=bt709:range=tv';

function usesX264(config: ProjectConfig): boolean {
  const codec = resolveVideoCodec(config);

  return codec === 'h264' || codec === 'libx264';
}

/**
 * Whether an `ffmpeg -version` number (`7.1`, `n7.1.1`, `8.1-static`) is at least major.minor. An
 * unknown or unparseable version (a git snapshot, the WASM core, the on-device engine) is `false`, so
 * those keep the historical flags.
 */
export function ffmpegAtLeast(version: string | null | undefined, major: number, minor: number): boolean {
  const match = /^n?(\d+)\.(\d+)/.exec(version ?? '');

  if (!match) return false;

  const [found, foundMinor] = [Number(match[1]), Number(match[2])];

  return found > major || (found === major && foundMinor >= minor);
}

/**
 * The `setparams` filter that **forces** every colour field — matrix, primaries, transfer and range —
 * to Rec.709 / limited-range on the frames themselves. Unlike the output flags above this overrides a
 * malformed source (`bt470bg`/full-range) rather than inheriting it, and is encoder-agnostic (works on
 * libx264, libopenh264, mpeg4, the WASM core). `setparams` is pixel-neutral metadata, so it can sit
 * anywhere in the chain; the engine appends it as the final node of each segment's video filtergraph,
 * and downstream passes (concat-copy, xfade, overlay) inherit the corrected tags.
 */
export function buildColorMetadataFilter(): string {
  return 'setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709';
}

export type QualityTier = 'draft' | 'standard' | 'high';

// 'standard' MUST reproduce the historical hardcoded arguments exactly — it is the default tier and
// existing callers must see byte-identical commands.
const SOFTWARE_TIERS: Record<QualityTier, { crf: number; preset: string; bitrate: string }> = {
  draft: { crf: 30, preset: 'veryfast', bitrate: '6M' },
  standard: { crf: 23, preset: 'medium', bitrate: '12M' },
  high: { crf: 18, preset: 'slow', bitrate: '16M' },
};

const HARDWARE_TIER_BITRATES: Record<QualityTier, string> = { draft: '4M', standard: '8M', high: '12M' };
const OPENH264_TIER_BITRATES: Record<QualityTier, string> = { draft: '2M', standard: '4M', high: '6M' };
const MPEG4_TIER_QSCALE: Record<QualityTier, number> = { draft: 8, standard: 4, high: 2 };

function isQualityTier(value: unknown): value is QualityTier {
  return typeof value === 'string' && Object.hasOwn(SOFTWARE_TIERS, value);
}

// Untyped callers (e.g. JSON-sourced config) can pass an unknown string; falling straight through
// to the tier tables would key-miss and produce `-crf undefined`. Guard against that here so every
// unrecognised value quietly resolves to 'standard' instead of corrupting the encoder args.
function resolveTier(config: ProjectConfig): QualityTier {
  const { qualityTier } = config;

  if (isQualityTier(qualityTier)) {
    return qualityTier;
  }

  return 'standard';
}

/**
 * The libx264-style { crf, preset, bitrate } triplet for the resolved quality tier. Shared by
 * `buildVideoEncoderArgs` (Node/server default codec) and the Node/browser `VideoSegment` encoding
 * branches, so a `qualityTier` change reaches every software-encoded path from one table.
 */
export function resolveSoftwareTier(config: ProjectConfig): { crf: number; preset: string; bitrate: string } {
  return SOFTWARE_TIERS[resolveTier(config)];
}

/**
 * Full `-c:v …` args for re-encoded clips. Defaults to the software (libx264-style) settings used
 * by the server/web. When a hardware encoder (h264_mediacodec / h264_videotoolbox on device) is
 * selected, the libx264-only flags (crf/tune/profile/preset) are dropped — those encoders reject
 * them — in favour of a bitrate target. (Color/image segments use the bare `-c:v ${resolveVideoCodec()}`.)
 */
export function buildVideoEncoderArgs(config: ProjectConfig): string {
  const codec = resolveVideoCodec(config);
  const tier = resolveTier(config);

  if (isHardwareCodec(config)) {
    return `-c:v ${codec} -b:v ${HARDWARE_TIER_BITRATES[tier]}`;
  }

  // mpeg4 (the on-device LGPL software encoder) takes quality/bitrate, not the libx264-only flags.
  if (codec === 'mpeg4') {
    return `-c:v mpeg4 -q:v ${MPEG4_TIER_QSCALE[tier]}`;
  }

  // libopenh264 (Cisco's LGPL-OK software H.264, used on-device) — bitrate-based; no libx264 flags.
  // OpenH264 only encodes Constrained Baseline, so no `-profile:v` (main/high is rejected or ignored).
  if (codec === 'libopenh264') {
    return `-c:v libopenh264 -b:v ${OPENH264_TIER_BITRATES[tier]}`;
  }

  const software = resolveSoftwareTier(config);

  return `-c:v ${codec} -crf ${software.crf} -tune film -b:v ${software.bitrate} -profile:v high -preset ${config.hardwareConfig?.preset ?? software.preset}`;
}
