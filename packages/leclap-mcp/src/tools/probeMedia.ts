import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';

import type { McpServer, ServerContext } from '@modelcontextprotocol/server';
import { z } from 'zod';

import { mediaTraits, type MediaTraits, type ProbeVideoStream } from 'ffmpeg-video-composer';

import type { McpConfig } from '../config.js';
import { assertWithinMediaDir } from '../compose/pathGuard.js';

const execFileAsync = promisify(execFile);
const requireModule = createRequire(import.meta.url);

// ffprobe on a well-formed file returns in well under a second. Bound it so a pathological input
// under the media dir (a FIFO/named pipe, a special file) can't block the tool forever — execFile
// SIGKILLs the child on overrun, and the rejected promise surfaces as a clean tool error.
const PROBE_TIMEOUT_MS = 30_000;

const inputSchema = z.object({
  path: z.string(),
});

const outputSchema = z.object({
  durationSeconds: z.number().nullable(),
  videoCodec: z.string().nullable(),
  audioCodec: z.string().nullable(),
  sampleRate: z.number().nullable(),
  sizeBytes: z.number(),
  hdr: z.enum(['pq', 'hlg', 'dolby-vision']).nullable(),
  colorPrimaries: z.string().nullable(),
  colorTransfer: z.string().nullable(),
  bitDepth: z.number().nullable(),
  vfr: z.boolean(),
  rotation: z.number(),
});

interface FFProbeStream extends ProbeVideoStream {
  codec_type: string;
  codec_name?: string | null;
  duration?: string;
  start_time?: string;
  sample_rate?: string;
  tags?: Record<string, string>;
}

interface FFProbeData {
  // Optional because the JSON comes from ffprobe at runtime; a malformed payload may omit it.
  streams?: FFProbeStream[];
  format?: { duration?: string; start_time?: string };
}

export interface ProbeInfos {
  durationSeconds: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  sampleRate: number | null;
  sizeBytes: number;
  /** HDR transfer of the video stream (PQ, HLG or Dolby Vision), or null for SDR. */
  hdr: MediaTraits['hdr'];
  colorPrimaries: string | null;
  colorTransfer: string | null;
  bitDepth: number | null;
  /** r_frame_rate and avg_frame_rate disagree: a variable-frame-rate capture (the engine conforms it). */
  vfr: boolean;
  /** Display rotation FFmpeg autorotates by on input, 0/90/180/270. */
  rotation: number;
  // Index signature so the object satisfies the SDK's structuredContent record type.
  [key: string]: unknown;
}

type ToolError = { isError: true; content: [{ type: 'text'; text: string }] };

function errorResult(text: string): ToolError {
  return { isError: true, content: [{ type: 'text', text }] };
}

// Resolve the ffprobe binary the same way the core does: prefer `ffprobe` on PATH, fall back to the
// binary shipped alongside ffmpeg-static (sibling of the ffmpeg-static path, name swapped). Cached
// after first resolution.
let cachedBin: string | undefined;

async function execProbe(bin: string, args: string[], signal?: AbortSignal) {
  signal?.throwIfAborted();
  const pending = execFileAsync(bin, args, { timeout: PROBE_TIMEOUT_MS, killSignal: 'SIGKILL' });
  // Node's execFile signal path can send SIGTERM despite killSignal. Kill explicitly,
  // then await the child callback so a preflight permit remains held until cleanup.
  function abort() {
    pending.child.kill('SIGKILL');
  }
  signal?.addEventListener('abort', abort, { once: true });

  if (signal?.aborted) abort();

  try {
    const result = await pending;
    signal?.throwIfAborted();

    return result;
  } catch (error) {
    signal?.throwIfAborted();

    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

async function resolveFfprobeBin(signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();

  if (cachedBin !== undefined) {
    return cachedBin;
  }

  try {
    await execProbe('ffprobe', ['-version'], signal);
    cachedBin = 'ffprobe';

    return cachedBin;
  } catch {
    signal?.throwIfAborted();
    cachedBin = resolveStaticFfprobe();

    return cachedBin;
  }
}

const NO_FFPROBE_MESSAGE =
  'No ffprobe binary found. Install FFmpeg so `ffprobe` is on PATH, or add the optional `ffprobe-static` package next to @leclap/mcp.';

function resolveStaticFfprobe(): string {
  try {
    // Not a dependency of this package — an operator opt-in. When installed, its platform binary
    // is a real ffprobe; nothing in the default install satisfies this require.
    const ffprobeStatic = requireModule('ffprobe-static') as { path: string };

    return ffprobeStatic.path;
  } catch {
    return resolveFfprobeBesideFfmpegStatic();
  }
}

// `ffmpeg-static` ships ONLY an ffmpeg binary — there is no sibling ffprobe in the package — so the
// name-swapped path is useful solely for layouts where an operator dropped an ffprobe next to it.
// The existence check turns the old raw `spawn …/ffprobe ENOENT` into the actionable message.
function resolveFfprobeBesideFfmpegStatic(): string {
  let candidate: string | null = null;

  try {
    const ffmpegStatic = requireModule('ffmpeg-static') as string | null;
    candidate = ffmpegStatic
      ? ffmpegStatic.replace(/ffmpeg(\.exe)?$/, (_m, ext: string | undefined) => `ffprobe${ext ?? ''}`)
      : null;
  } catch {
    throw new Error(NO_FFPROBE_MESSAGE);
  }

  if (!candidate || !existsSync(candidate)) {
    throw new Error(NO_FFPROBE_MESSAGE);
  }

  return candidate;
}

// Probe a local file by invoking ffprobe directly via execFile. This captures stdout into a buffer
// (zero fd-1 pollution) and deliberately bypasses the core's DI-wired adapter, which logs via pino
// straight to fd 1 — that would corrupt the MCP stdio JSON-RPC framing.
export type ProbeRunner = (realPath: string, signal?: AbortSignal) => Promise<FFProbeData>;

async function defaultRunner(realPath: string, signal?: AbortSignal): Promise<FFProbeData> {
  const bin = await resolveFfprobeBin(signal);
  const { stdout } = await execProbe(
    bin,
    ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', realPath],
    signal
  );

  return JSON.parse(stdout) as FFProbeData;
}

function numericDuration(value: string | undefined): number | null {
  if (!value) return null;
  const number = Number(value);

  return Number.isFinite(number) && number >= 0 ? number : null;
}

function elapsedDuration(timestamp: number | null, startTime: string | undefined): number | null {
  if (timestamp === null) return null;
  const start = Number(startTime ?? 0);
  // These fallback values are end timestamps in WebM. A true stream.duration is already elapsed.
  return Math.max(0, timestamp - (Number.isFinite(start) ? Math.max(0, start) : 0));
}

function parseDuration(stream: FFProbeStream | undefined): number | null {
  const duration = numericDuration(stream?.duration);

  if (duration !== null) return duration;
  // Matroska/WebM commonly stores per-stream duration as HH:MM:SS in tags instead.
  const tag = stream?.tags?.DURATION ?? stream?.tags?.duration;
  const match = tag?.match(/^(\d+):([0-5]\d):([0-5]\d(?:\.\d+)?)$/);

  return match
    ? elapsedDuration(Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]), stream?.start_time)
    : null;
}

function parseSampleRate(stream: FFProbeStream | undefined): number | null {
  if (!stream?.sample_rate) {
    return null;
  }

  const value = Number.parseInt(stream.sample_rate, 10);

  return Number.isNaN(value) ? null : value;
}

function durationFor(streams: FFProbeStream[], format: FFProbeData['format']): number | null {
  const primary =
    streams.find((stream) => stream.codec_type === 'video') ?? streams.find((stream) => stream.codec_type === 'audio');
  // A longer audio/container duration cannot establish that video lasts ten seconds.
  // Container fallback is safe for a single-stream file, including video-only WebM.
  return (
    parseDuration(primary) ??
    (streams.length === 1
      ? elapsedDuration(numericDuration(format?.duration), streams[0].start_time ?? format?.start_time)
      : null)
  );
}

export async function probeMedia(
  realPath: string,
  sizeBytes: number,
  runner: ProbeRunner = defaultRunner,
  signal?: AbortSignal
): Promise<ProbeInfos> {
  signal?.throwIfAborted();
  const data = await runner(realPath, signal);
  signal?.throwIfAborted();
  const streams = data.streams ?? [];
  const videoStream = streams.find((s) => s.codec_type === 'video');
  const audioStream = streams.find((s) => s.codec_type === 'audio');

  return {
    durationSeconds: durationFor(streams, data.format),
    videoCodec: videoStream?.codec_name ?? null,
    audioCodec: audioStream?.codec_name ?? null,
    sampleRate: parseSampleRate(audioStream),
    sizeBytes,
    ...mediaTraits(videoStream),
  };
}

// Only the traits that change how a clip should be handled: HDR, VFR and rotation.
function traitsNote(infos: ProbeInfos): string {
  const notes = [
    ...(infos.hdr ? [`HDR ${infos.hdr}`] : []),
    ...(infos.vfr ? ['VFR'] : []),
    ...(infos.rotation ? [`rotated ${infos.rotation}°`] : []),
  ];

  return notes.length > 0 ? `, ${notes.join(', ')}` : '';
}

async function handleProbe(args: { path: string }, config: McpConfig, runner: ProbeRunner, signal?: AbortSignal) {
  let realPath: string;

  try {
    realPath = await assertWithinMediaDir(args.path, config.mediaDir);
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }

  try {
    const { size } = await fs.stat(realPath);
    const infos = await probeMedia(realPath, size, runner, signal);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Probed ${realPath} (${infos.durationSeconds ?? '?'}s, ${infos.videoCodec ?? 'no video'}/${infos.audioCodec ?? 'no audio'}, ${infos.sizeBytes} bytes${traitsNote(infos)}).`,
        },
      ],
      structuredContent: infos,
    };
  } catch (error) {
    return errorResult(`Probe failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function registerProbe(server: McpServer, config: McpConfig, runner: ProbeRunner = defaultRunner): void {
  server.registerTool(
    'probe_media',
    {
      title: 'Probe Media',
      description:
        'Inspect a local media file (absolute path under the configured media dir) and return its ' +
        'duration, video/audio codecs, audio sample rate, byte size and footage traits (hdr: pq/hlg/dolby-vision, ' +
        'colorPrimaries/colorTransfer, bitDepth, vfr, rotation). Probes via ffprobe directly ' +
        'so it never writes to stdout.',
      inputSchema,
      outputSchema,
    },
    (args: { path: string }, ctx?: ServerContext) => handleProbe(args, config, runner, ctx?.mcpReq.signal)
  );
}
