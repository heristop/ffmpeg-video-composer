// D5/D7 — one choke point for every FFmpeg command a compile runs. The director taps the adapter for the
// duration of a build: each command is (optionally) rewritten with the deterministic output profile, then
// recorded for the render manifest. Doing it at the adapter seam, rather than in each of the command
// builders (segments, concat, xfade assembly, music mix, whole-video animations), means no output path
// can forget the profile, and the Node, WASM and on-device engines all get it identically.

import type AbstractFFmpeg from '../../platform/ffmpeg/AbstractFFmpeg';

/**
 * Bit-exact muxing: no encoder/library version strings, no creation time, no inherited source metadata.
 * The same frames then always produce the same container bytes on a given encoder.
 */
export const BITEXACT_OUTPUT_ARGS = '-fflags +bitexact -flags:v +bitexact -flags:a +bitexact -map_metadata -1';

/**
 * libx264 splits work by thread count, and its default (`auto`) follows the CPU count, so the same
 * command encodes differently on a 4-core laptop and a 16-core CI runner. A fixed count keeps
 * the bitstream identical across machines with no measurable cost on short segments.
 */
export const X264_THREADS = 4;

function encodesWithX264(command: string): boolean {
  return /-c:v\s+(?:h264|libx264)(?:\s|$)/.test(command);
}

// Start index of the command's last argument (the output path), honouring quotes the same way
// parse-command.ts does. -1 when the command has no argument at all.
function lastArgumentStart(command: string): number {
  let start = -1;
  let inToken = false;
  let quote: string | null = null;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (quote !== null) {
      quote = char === quote ? null : quote;

      continue;
    }

    if (char === ' ') {
      inToken = false;

      continue;
    }

    if (!inToken) start = i;

    inToken = true;
    quote = char === '"' || char === "'" ? char : null;
  }

  return start;
}

/** Inserts output options just before the output path (the last argument) of an FFmpeg command. */
export function injectOutputArgs(command: string, args: string): string {
  const trimmed = command.trimEnd();
  const start = lastArgumentStart(trimmed);

  if (start <= 0 || !/(?:^|\s)-i\s/.test(trimmed)) return command;

  return `${trimmed.slice(0, start)}${args} ${trimmed.slice(start)} `;
}

/** The deterministic encoder profile applied to one render command. */
export function applyDeterministicProfile(command: string): string {
  const threads = encodesWithX264(command) ? ` -threads ${X264_THREADS}` : '';

  return injectOutputArgs(command, `${BITEXACT_OUTPUT_ARGS}${threads}`);
}

/**
 * Wraps the execution of one (already profiled and recorded) command, e.g. the Node section cache,
 * which can satisfy a segment render from a previous identical one instead of running FFmpeg.
 */
export type CommandInterceptor = (
  command: string,
  run: (command: string) => Promise<{ rc: number }>
) => Promise<{ rc: number }>;

export interface CommandTapOptions {
  deterministic: boolean;
  onCommand: (command: string) => void;
  intercept?: CommandInterceptor | null;
}

/**
 * Wraps `adapter.execute` for the duration of a build and returns the restore function. Patched on the
 * instance (not by subclassing) so every component that resolved the shared adapter, including ones
 * with a virtual filesystem, goes through the tap, and nothing else about the adapter changes.
 */
export function tapFFmpegCommands(adapter: AbstractFFmpeg, options: CommandTapOptions): () => void {
  const own = Object.getOwnPropertyDescriptor(adapter, 'execute');
  const original = adapter.execute.bind(adapter);

  adapter.execute = (command: string) => {
    const effective = options.deterministic ? applyDeterministicProfile(command) : command;
    options.onCommand(effective);

    return options.intercept ? options.intercept(effective, original) : original(effective);
  };

  return () => {
    if (own) {
      Object.defineProperty(adapter, 'execute', own);

      return;
    }

    Reflect.deleteProperty(adapter, 'execute');
  };
}
