import AbstractFFmpeg from './AbstractFFmpeg';
import { parseCommand } from './parse-command';
import { FFmpegError } from '../../core/errors/FFmpegError';
import type { FFMpegInfos } from '../../core/types';
import { reportedTraits } from '../../core/footage/media-traits';

/**
 * The native FFmpeg CLI engine (the `leclap-ffmpeg` Expo module), injected by the React-Native entry
 * so the platform-agnostic core never imports app/Expo code. `run` executes an ffmpeg command and
 * returns its exit code; `probe` runs ffprobe and returns its captured stdout.
 */
export interface NativeEngine {
  run(args: string[]): Promise<{ code: number; log: string }> | { code: number; log: string };
  probe(args: string[]): Promise<{ code: number; output: string }> | { code: number; output: string };
  /**
   * M3 (optional, supplied by the React-Native entry): a fresh writable path for ffmpeg's
   * `-progress <file>`, and a reader for it. When both are present — and the director has set a
   * `progressListener` + `expectedDurationSeconds` — `execute()` polls the file to surface live
   * intra-segment progress. Absent (tests, WASM path) → progress stays per-segment coarse.
   */
  progressFilePath?(): string;
  readTextFile?(path: string): Promise<string>;
}

// ffmpeg `-progress` appends repeated `key=value` blocks; the latest `out_time_us` is the current
// output position in microseconds. Returns the last parseable value, or null if none written yet.
function parseProgressMicros(text: string): number | null {
  let micros: number | null = null;

  for (const line of text.split('\n')) {
    const eq = line.indexOf('=');
    const key = eq > 0 ? line.slice(0, eq) : '';

    if (key !== 'out_time_us' && key !== 'out_time_ms') {
      continue;
    }

    const value = Number(line.slice(eq + 1).trim());

    if (Number.isFinite(value)) {
      micros = value;
    }
  }

  return micros;
}

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  duration?: string;
  sample_rate?: string;
}

/**
 * Drives the on-device FFmpeg CLI engine. The core hands `execute()` a full command string (no
 * program name); we split it to argv and run it natively — no MEMFS bridging, since the engine reads
 * the real device paths the core wrote. `getInfos()` shells ffprobe to JSON and maps it to FFMpegInfos.
 */
class FFmpegDeviceAdapter extends AbstractFFmpeg {
  constructor(private readonly engine: NativeEngine) {
    super();
  }

  execute = async (command: string): Promise<{ rc: number }> => {
    const args = parseCommand(command);
    const stopProgress = this.startProgressTracking(args);

    try {
      const { code, log } = await this.engine.run(args);

      if (code !== 0) {
        // The captured stderr (`log`) is the actual ffmpeg error — surface its tail.
        const tail = log.split('\n').filter(Boolean).slice(-8).join('\n');

        throw new FFmpegError('FFmpeg command failed', `rc=${code}\n${tail}\ncmd: ffmpeg ${command}`);
      }

      return { rc: code };
    } finally {
      stopProgress();
    }
  };

  // When the engine supplies a progress file + reader and the director set a listener + duration,
  // inject `-progress <file>` (a global option, so it leads argv) and poll it. Returns a stopper;
  // a no-op when any piece is missing.
  private readonly startProgressTracking = (args: string[]): (() => void) => {
    const path = this.engine.progressFilePath?.();
    const duration = this.expectedDurationSeconds;

    if (!path || !this.engine.readTextFile || !this.progressListener || duration === undefined || duration <= 0) {
      return () => {};
    }

    args.unshift('-progress', path);

    return this.pollProgress(path, duration);
  };

  private readonly pollProgress = (path: string, durationSeconds: number): (() => void) => {
    const listener = this.progressListener;
    const read = (p: string): Promise<string> => this.engine.readTextFile?.(p) ?? Promise.resolve('');

    if (!listener) {
      return () => {};
    }

    let stopped = false;
    const timer = setInterval(() => {
      read(path)
        .then((text) => {
          const micros = stopped ? null : parseProgressMicros(text);

          if (micros !== null) {
            listener(Math.min(1, micros / 1_000_000 / durationSeconds));
          }
        })
        .catch(() => {});
    }, 500);

    return () => {
      stopped = true;
      clearInterval(timer);
    };
  };

  // The embedded ffprobe prints a `ffprobe version …` banner line on stdout ahead of the JSON
  // document (it slips past `-v quiet`), which made a strict JSON.parse fail on the leading `f`.
  // Slice to the outermost `{ … }` so only the JSON document is parsed.
  private static extractJsonObject(output: string): string {
    const start = output.indexOf('{');
    const end = output.lastIndexOf('}');

    if (start === -1 || end <= start) {
      return output;
    }

    return output.slice(start, end + 1);
  }

  private readonly parseProbeStreams = (output: string, source: string): ProbeStream[] => {
    try {
      return (JSON.parse(FFmpegDeviceAdapter.extractJsonObject(output)) as { streams?: ProbeStream[] }).streams ?? [];
    } catch (error) {
      // Some camera-recorded MP4s (e.g. react-native-vision-camera output) make ffprobe emit a non-JSON
      // line instead of the document. Don't abort the whole compile — return no streams so the caller
      // falls back to the section's declared duration; the render still decodes the clip natively.
      console.warn(`[FFmpegDeviceAdapter] ffprobe output not parseable for ${source}: ${String(error)}`);

      return [];
    }
  };

  getInfos = async (source: string): Promise<FFMpegInfos> => {
    const { code, output } = await this.engine.probe([
      '-hide_banner',
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_streams',
      source,
    ]);

    if (code !== 0) {
      throw new FFmpegError(`FFprobe analysis failed for ${source}`, `rc=${code}`);
    }

    const streams = this.parseProbeStreams(output, source);

    const video = streams.find((s) => s.codec_type === 'video');
    const audio = streams.find((s) => s.codec_type === 'audio');
    const durationStr = video?.duration ?? audio?.duration;

    return {
      duration: durationStr ? parseFloat(durationStr) : null,
      videoCodec: video?.codec_name ?? null,
      audioCodec: audio?.codec_name ?? null,
      sampleRate: audio?.sample_rate ? parseInt(audio.sample_rate, 10) : null,
      ...reportedTraits(video),
    };
  };
}

export default FFmpegDeviceAdapter;
