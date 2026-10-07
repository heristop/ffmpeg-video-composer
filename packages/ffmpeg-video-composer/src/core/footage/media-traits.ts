// Colour and timing traits of a probed video stream, read off ffprobe's `-show_streams` JSON. Pure, so
// the engine adapters (Node, static, on-device) and the MCP `probe_media` tool report the same facts:
// HDR transfer (PQ / HLG / Dolby Vision), primaries, bit depth, variable frame rate and the display
// rotation FFmpeg's autorotation applies on `-i`.

import type { MediaTraits } from '../types';

/** The subset of an ffprobe stream these traits read. */
export interface ProbeVideoStream {
  codec_tag_string?: string;
  pix_fmt?: string;
  bits_per_raw_sample?: string;
  color_transfer?: string;
  color_primaries?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  tags?: Record<string, string>;
  side_data_list?: Array<{ side_data_type?: string; rotation?: number }>;
}

const PQ = new Set(['smpte2084']);
const HLG = new Set(['arib-std-b67']);
const DOLBY_VISION_TAGS = new Set(['dvh1', 'dvhe', 'dav1', 'dva1', 'dvav']);

/** A frame-rate ratio ("30000/1001") as a number, or null for "0/0" / malformed values. */
export function frameRate(ratio: string | undefined): number | null {
  const parts = (ratio ?? '').split('/').map(Number);
  const rate = (parts.at(0) ?? Number.NaN) / (parts.at(1) ?? 1);

  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

function hasSideData(stream: ProbeVideoStream, needle: string): boolean {
  return (stream.side_data_list ?? []).some((entry) => entry.side_data_type?.toLowerCase().includes(needle));
}

function hdrKind(stream: ProbeVideoStream): MediaTraits['hdr'] {
  if (DOLBY_VISION_TAGS.has(stream.codec_tag_string ?? '') || hasSideData(stream, 'dovi')) return 'dolby-vision';

  if (PQ.has(stream.color_transfer ?? '')) return 'pq';

  return HLG.has(stream.color_transfer ?? '') ? 'hlg' : null;
}

function bitDepth(stream: ProbeVideoStream): number | null {
  const raw = Number(stream.bits_per_raw_sample);

  if (Number.isInteger(raw) && raw > 0) return raw;

  // yuv420p10le, p010le, yuv422p12be… — no digit run means an 8-bit format.
  const match = /p(\d{2})(?:le|be)$/.exec(stream.pix_fmt ?? '') ?? /^p0(\d{2})/.exec(stream.pix_fmt ?? '');

  if (match) return Number(match[1]);

  return stream.pix_fmt ? 8 : null;
}

// Real-time and average rate disagreeing by more than 1% is a variable-frame-rate clip (phone captures).
function isVfr(stream: ProbeVideoStream): boolean {
  const real = frameRate(stream.r_frame_rate);
  const average = frameRate(stream.avg_frame_rate);

  return real !== null && average !== null && Math.abs(real - average) / real > 0.01;
}

/** Display rotation in degrees, normalised to 0/90/180/270, from the display matrix or a legacy `rotate` tag. */
export function displayRotation(stream: ProbeVideoStream): number {
  const matrix = (stream.side_data_list ?? []).find((entry) => typeof entry.rotation === 'number')?.rotation;
  const raw = matrix ?? Number(stream.tags?.rotate ?? 0);
  const quarter = Math.round((Number.isFinite(raw) ? raw : 0) / 90) * 90;

  return ((quarter % 360) + 360) % 360;
}

const TRAIT_KEYS = ['pix_fmt', 'color_transfer', 'color_primaries', 'r_frame_rate', 'side_data_list', 'tags'] as const;

/**
 * `{ traits }` to spread into an adapter's FFMpegInfos when the probe reported any trait field, else `{}`
 * (a probe that printed only codec/duration — a minimal mock, a stripped engine — claims nothing).
 */
export function reportedTraits(stream: unknown): { traits?: MediaTraits } {
  const video = stream as ProbeVideoStream | undefined;

  return video && TRAIT_KEYS.some((key) => video[key] !== undefined) ? { traits: mediaTraits(video) } : {};
}

export function mediaTraits(stream: ProbeVideoStream | undefined): MediaTraits {
  if (!stream) {
    return { hdr: null, colorPrimaries: null, colorTransfer: null, bitDepth: null, vfr: false, rotation: 0 };
  }

  return {
    hdr: hdrKind(stream),
    colorPrimaries: stream.color_primaries ?? null,
    colorTransfer: stream.color_transfer ?? null,
    bitDepth: bitDepth(stream),
    vfr: isVfr(stream),
    rotation: displayRotation(stream),
  };
}
