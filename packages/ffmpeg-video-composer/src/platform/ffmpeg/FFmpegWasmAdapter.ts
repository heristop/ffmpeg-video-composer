import { inject, injectable } from 'tsyringe';
import type { FFMpegInfos } from '@/core/types';
import AbstractFFmpeg, { type FSNode, type VirtualFilesystemFFmpeg } from './AbstractFFmpeg';
import { loadCoreFromCdn, type FFmpegCoreLoader } from './ffmpeg-core';
import { parseCommand } from './parse-command';
import { FFmpegError } from '../../core/errors/FFmpegError';
import type AbstractFilesystem from '../filesystem/AbstractFilesystem';

export type { FSNode };
export { FFMPEG_CORE_VERSION, type FFmpegCoreLoader, type FFmpegCoreTarget } from './ffmpeg-core';

interface FFmpegWasm {
  load(config?: { coreURL: string; wasmURL: string }): Promise<void>;
  exec(args: string[]): Promise<void>;
  writeFile(name: string, data: Uint8Array): Promise<void>;
  readFile(name: string): Promise<Uint8Array>;
  deleteFile(name: string): Promise<void>;
  createDir(path: string): Promise<void>;
  listDir(path: string): Promise<FSNode[]>;
  on(event: string, callback: (data: { message?: string; progress?: number; time?: number }) => void): void;
  off(event: string, callback: (data: { message?: string; progress?: number; time?: number }) => void): void;
}

type FFmpegLogData = { message?: string; progress?: number; time?: number };

@injectable()
class FFmpegWasmAdapter extends AbstractFFmpeg implements VirtualFilesystemFFmpeg {
  readonly usesVirtualFilesystem = true;
  private ffmpeg: FFmpegWasm | null = null;
  private isLoaded = false;
  // Settles once the core has loaded, or failed to: waitForReady() hands that failure straight back.
  private readonly initialization: Promise<void>;

  // `loadCore` decides where the ffmpeg.wasm core comes from; the pinned version from unpkg unless the host
  // serves its own.
  constructor(
    @inject('filesystemAdapter') private readonly fs: AbstractFilesystem,
    private readonly loadCore: FFmpegCoreLoader = loadCoreFromCdn
  ) {
    super();
    this.initialization = this.initializeFFmpeg();
    this.initialization.catch((error: unknown) => {
      console.error(
        '[FFmpegWasmAdapter] Initialization failed:',
        error instanceof Error ? error.message : String(error)
      );
    });
  }

  private async initializeFFmpeg(): Promise<void> {
    try {
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');

      this.ffmpeg = new FFmpeg() as unknown as FFmpegWasm;

      this.ffmpeg.on('log', ({ message }) => {
        console.log('[FFmpegWasm]', message);
      });

      // ffmpeg-core's own `progress` ratio is unreliable — for the per-segment compile passes the input has
      // no parseable Duration, so it comes back as garbage (huge negative). Derive the 0..1 fraction from the
      // reliable elapsed `time` (microseconds) over the director-supplied expected duration instead, the same
      // way the on-device CLI adapter does (FFmpegDeviceAdapter.pollProgress).
      this.ffmpeg.on('progress', ({ time }) => {
        const duration = this.expectedDurationSeconds;

        if (!this.progressListener || duration === undefined || duration <= 0 || time === undefined) return;

        this.progressListener(Math.min(1, Math.max(0, time / 1_000_000 / duration)));
      });

      await this.loadCore(this.ffmpeg);

      this.isLoaded = true;
    } catch (error) {
      throw new Error(
        `Failed to initialize FFmpeg WebAssembly: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private getFFmpeg(): FFmpegWasm {
    if (!this.ffmpeg || !this.isLoaded) {
      throw new FFmpegError('FFmpeg WebAssembly not loaded. Call await ffmpeg.load() first.');
    }

    return this.ffmpeg;
  }

  // A load that failed (the core couldn't be fetched offline, say) rejects right away with its own error;
  // only one that hangs runs into the timeout.
  waitForReady = (): Promise<void> => {
    // execute() awaits this before every command: once loaded, don't arm a timer each time.
    if (this.isLoaded) {
      return Promise.resolve();
    }

    const maxWaitTime = 30000; // 30 seconds
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new FFmpegError('Timeout waiting for FFmpeg WebAssembly to load'));
      }, maxWaitTime);
    });

    return Promise.race([this.initialization, timeout]).finally(() => {
      clearTimeout(timer);
    });
  };

  // Capture ffmpeg's log stream into an error list + a rolling tail (minus the version/config
  // banner) so a failure can be diagnosed even when the only flagged line is the benign trailing
  // "Aborted()". Returns the buffers plus a detach() to remove the listener.
  private attachLogCapture(ffmpeg: FFmpegWasm): {
    errorMessages: string[];
    recentLog: string[];
    detach: () => void;
  } {
    const errorMessages: string[] = [];
    const recentLog: string[] = [];

    function errorCallback({ message }: FFmpegLogData) {
      if (!message) {
        return;
      }

      const isBanner =
        message.includes('ffmpeg version') || message.includes('configuration:') || message.startsWith('  lib');

      if (!isBanner) {
        recentLog.push(message);

        if (recentLog.length > 12) {
          recentLog.shift();
        }
      }

      const isError = message.toLowerCase().includes('error') && !isBanner;
      const isAbort = message.includes('Aborted()') || message.includes('abort');

      if (isError || isAbort) {
        console.error('[FFmpegWasm Error]', message);
        errorMessages.push(message);
      }
    }

    ffmpeg.on('log', errorCallback);

    return {
      errorMessages,
      recentLog,
      detach: () => {
        ffmpeg.off('log', errorCallback);
      },
    };
  }

  execute = async (command: string): Promise<{ rc: number }> => {
    await this.waitForReady();
    const ffmpeg = this.getFFmpeg();

    const { errorMessages, recentLog, detach } = this.attachLogCapture(ffmpeg);

    try {
      const args = parseCommand(command);

      // The filesystem adapter (this.fs) and ffmpeg's MEMFS are separate stores.
      // Copy every input file the command references into MEMFS at the same path
      // before running, otherwise ffmpeg aborts with "No such file or directory".
      await this.bridgeInputsToMemfs(ffmpeg, args);

      // Ready the output path in MEMFS: its parent directories, so ffmpeg can write a full-path output
      // (e.g. /tmp/build/<segment>_output.mp4), and no stale file an earlier command left there.
      const outputPath = FFmpegWasmAdapter.resolveOutputPath(args);

      if (outputPath !== undefined) {
        await this.readyMemfsOutput(ffmpeg, args, outputPath);
      }

      await ffmpeg.exec(args);

      detach();

      // Copy the produced output back out of MEMFS into the filesystem adapter
      // so the rest of the compilation pipeline can read it. ffmpeg-core logs
      // "Aborted()" even on a normal exit, so success is decided by whether the
      // output file was actually produced - not by scanning the logs.
      const produced = await this.bridgeOutputFromMemfs(ffmpeg, args);

      // Fail only when the command was supposed to produce an output file but
      // didn't. Commands with no output arg (e.g. `-version`, used by form
      // segments) are not failures, and ffmpeg-core logs "Aborted()" even on a
      // normal exit - so the log alone is not a reliable failure signal.
      if (outputPath !== undefined && !produced) {
        // Surface the REAL failure, not the benign trailing "Aborted()": prefer a captured error line
        // that isn't the abort, else the tail of the ffmpeg output, plus the output it was writing.
        const realError = errorMessages.find((m) => !m.includes('Aborted()') && !m.toLowerCase().includes('abort'));
        const detail = realError ?? recentLog.slice(-6).join(' / ');

        throw new FFmpegError('FFmpeg WASM execution failed', `${detail} (while writing ${outputPath})`);
      }

      return { rc: 0 };
    } catch (error) {
      detach();

      // The "no output produced" failure (above) is already a precise FFmpegError — re-throw it as-is
      // rather than re-wrapping it in the generic message below.
      if (error instanceof FFmpegError) throw error;

      // ffmpeg.exec() rejects with an empty/opaque error, so the real cause lives in the captured log
      // stream (a missing filter/encoder/font surfaces there, not on the thrown error).
      throw new FFmpegError(
        'FFmpeg WebAssembly command failed',
        FFmpegWasmAdapter.describeFailure(errorMessages, recentLog, error)
      );
    }
  };

  // The real failure, not the benign trailing "Aborted()": prefer a captured non-abort error line, else
  // the tail of the ffmpeg log, else the thrown message — first non-empty wins.
  private static describeFailure(errorMessages: string[], recentLog: string[], error: unknown): string {
    const realError = errorMessages.find((m) => !m.includes('Aborted()') && !m.toLowerCase().includes('abort'));
    const thrown = error instanceof Error ? error.message : '';
    const detail = [realError, recentLog.slice(-6).join(' / '), thrown].find((m) => m !== undefined && m !== '');

    return detail ?? 'Unknown error';
  }

  /**
   * Collect every file path the command references that must exist in MEMFS:
   * the `-i` inputs plus any absolute `/tmp/...` path embedded in another arg
   * (e.g. a drawtext `fontfile=/tmp/build/fonts/X.ttf` inside -filter_complex).
   */
  private static collectReferencedPaths(args: string[]): string[] {
    const paths = new Set<string>();

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      if (arg === '-i' && i + 1 < args.length) {
        paths.add(args[i + 1] ?? '');
      }

      const embedded = arg.match(/\/tmp\/[^\s'":,]+/g);

      if (embedded) {
        for (const match of embedded) {
          paths.add(match);
        }
      }
    }

    return [...paths].filter(Boolean);
  }

  /**
   * The concat-demuxer lists a command reads: the `-i` following each `-f concat` (other input options,
   * such as `-safe 0`, may sit between them). A segment command can read one after other `-f` inputs.
   */
  static concatListPaths(args: string[]): string[] {
    return args.flatMap((arg, index) => {
      if (arg !== '-f' || args[index + 1] !== 'concat') return [];

      const input = args.indexOf('-i', index);

      return input === -1 || input + 1 >= args.length ? [] : [args[input + 1]];
    });
  }

  /**
   * For a concat-demuxer command (`-f concat -i <list>`), read each list from the filesystem adapter and
   * return the files it references (`file '<path>'` lines). These are not present in the command args, so
   * without this they never reach MEMFS and the concat aborts.
   */
  private async collectConcatSegmentPaths(args: string[]): Promise<string[]> {
    const lists = await Promise.all(FFmpegWasmAdapter.concatListPaths(args).map((list) => this.readConcatList(list)));

    return lists.flat();
  }

  private async readConcatList(listPath: string): Promise<string[]> {
    try {
      if (!(await this.fs.stat(listPath))) {
        return [];
      }

      return FFmpegWasmAdapter.parseConcatList(await this.fs.read(listPath));
    } catch (error) {
      console.warn(
        `[FFmpegWasmAdapter] Could not read concat list ${listPath}: ${error instanceof Error ? error.message : String(error)}`
      );

      return [];
    }
  }

  /**
   * Parse a concat-demuxer list into the segment file paths it references. Lines look like
   * `file '/tmp/build/intro_output.mp4'` (quoted) or `file /tmp/build/intro_output.mp4`; other
   * directives (comments, `duration`, blanks) are ignored.
   */
  static parseConcatList(content: string): string[] {
    return content
      .split('\n')
      .map((line) => line.match(/^\s*file\s+'?(.+?)'?\s*$/)?.[1]?.trim())
      .filter((path): path is string => Boolean(path));
  }

  /**
   * The output file is the final positional argument of an FFmpeg command.
   */
  private static resolveOutputPath(args: string[]): string | undefined {
    const last = args.at(-1);

    return last !== undefined && !last.startsWith('-') ? last : undefined;
  }

  /**
   * Ready an output path in MEMFS: create its parent directories, and drop any file an earlier command
   * left there. MEMFS outlives a render, so a stale file would pass for this command's output: a run that
   * fails to write it would still have "produced" it, and a clip FFmpeg couldn't read would render as the
   * previous render's clip. A path the command also reads is left alone.
   */
  private async readyMemfsOutput(ffmpeg: FFmpegWasm, args: string[], outputPath: string): Promise<void> {
    await this.ensureMemfsDir(ffmpeg, outputPath);

    const readsIt = args.some((arg, index) => arg === outputPath && args[index - 1] === '-i');

    if (readsIt) {
      return;
    }

    try {
      await ffmpeg.deleteFile(outputPath);
    } catch {
      // Nothing there: the usual case.
    }
  }

  /**
   * Recursively create the parent directories of a file path inside MEMFS.
   */
  private async ensureMemfsDir(ffmpeg: FFmpegWasm, filePath: string): Promise<void> {
    const segments = filePath.split('/').slice(0, -1).filter(Boolean);

    // Create each prefix sequentially (parent before child); ignore "already exists".
    await segments.reduce<Promise<void>>(
      (chain, _segment, index) =>
        chain.then(async () => {
          const dir = `/${segments.slice(0, index + 1).join('/')}`;

          try {
            await ffmpeg.createDir(dir);
          } catch {
            // Directory already exists - nothing to do.
          }
        }),
      Promise.resolve()
    );
  }

  /**
   * Mirror every input file referenced by the command from the filesystem
   * adapter into ffmpeg's MEMFS at the same path.
   */
  private async bridgeInputsToMemfs(ffmpeg: FFmpegWasm, args: string[]): Promise<void> {
    const direct = FFmpegWasmAdapter.collectReferencedPaths(args);
    // A `-f concat -i list.txt` command only names the list in its args; the segment files the
    // list points at must also be mirrored into MEMFS or the concat demuxer aborts. This is what
    // makes multi-section templates (intro + clip + outro) render in the browser, not just
    // single-section ones.
    const concatSegments = await this.collectConcatSegmentPaths(args);
    const inputs = [...new Set([...direct, ...concatSegments])];

    await Promise.all(
      inputs.map(async (input) => {
        try {
          if (!(await this.fs.stat(input))) {
            return;
          }

          await this.ensureMemfsDir(ffmpeg, input);
          await ffmpeg.writeFile(input, await this.fs.readFile(input));
        } catch (error) {
          console.warn(
            `[FFmpegWasmAdapter] Could not bridge input ${input}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      })
    );
  }

  /**
   * Mirror the command's output file from MEMFS back into the filesystem adapter.
   * Returns true when an output file was actually produced and copied.
   */
  private async bridgeOutputFromMemfs(ffmpeg: FFmpegWasm, args: string[]): Promise<boolean> {
    const output = FFmpegWasmAdapter.resolveOutputPath(args);

    if (output === undefined) {
      return false;
    }

    try {
      const data = await ffmpeg.readFile(output);
      await this.fs.writeFile(output, data);

      return true;
    } catch {
      // Output not present in MEMFS (e.g. a probe-only command, or a failure).
      return false;
    }
  }

  private async loadSourceFileToMemfs(ffmpeg: FFmpegWasm, source: string, filename: string): Promise<void> {
    try {
      const fileExists = await this.fs.stat(source);

      if (!fileExists) {
        return;
      }

      const data = await this.fs.readFile(source);
      await ffmpeg.writeFile(filename, data);
    } catch (error) {
      console.warn(
        `[FFmpegWasmAdapter] Failed to load file from filesystem: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private parseMediaInfoFromLog(
    state: { duration: number | null; videoCodec: string | null; audioCodec: string | null },
    message: string
  ): void {
    // Parse Duration
    const durationMatch = message.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/);

    if (durationMatch) {
      const hours = parseFloat(durationMatch[1]);
      const minutes = parseFloat(durationMatch[2]);
      const seconds = parseFloat(durationMatch[3]);
      state.duration = hours * 3600 + minutes * 60 + seconds;
    }

    // Parse Video Stream
    if (message.includes('Video:')) {
      const videoMatch = message.match(/Video: ([^,]+)/);

      if (videoMatch) {
        state.videoCodec = videoMatch[1].trim();
      }
    }

    if (message.includes('Audio:')) {
      const audioMatch = message.match(/Audio: ([^,]+)/);

      if (audioMatch) {
        state.audioCodec = audioMatch[1].trim();
      }
    }
  }

  getInfos = async (source: string): Promise<FFMpegInfos> => {
    const ffmpeg = this.getFFmpeg();

    try {
      const filename = source.split('/').pop() ?? source;

      await this.loadSourceFileToMemfs(ffmpeg, source, filename);

      const state = {
        duration: null as number | null,
        videoCodec: null as string | null,
        audioCodec: null as string | null,
      };

      const logCallback = ({ message }: FFmpegLogData) => {
        if (message) {
          this.parseMediaInfoFromLog(state, message);
        }
      };

      ffmpeg.on('log', logCallback);

      await ffmpeg.exec(['-i', filename]);

      ffmpeg.off('log', logCallback);

      return {
        duration: state.duration,
        videoCodec: state.videoCodec,
        audioCodec: state.audioCodec,
        sampleRate: null,
      };
    } catch (error) {
      throw new FFmpegError(
        `FFmpeg WebAssembly analysis failed for ${source}`,
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  };

  writeFile = async (name: string, data: Uint8Array): Promise<void> => {
    const ffmpeg = this.getFFmpeg();
    await ffmpeg.writeFile(name, data);
  };

  readFile = async (name: string): Promise<Uint8Array> => {
    const ffmpeg = this.getFFmpeg();

    return await ffmpeg.readFile(name);
  };

  deleteFile = async (name: string): Promise<void> => {
    const ffmpeg = this.getFFmpeg();
    await ffmpeg.deleteFile(name);
  };

  listDir = async (path: string): Promise<FSNode[]> => {
    const ffmpeg = this.getFFmpeg();

    return await ffmpeg.listDir(path);
  };
}

export default FFmpegWasmAdapter;
