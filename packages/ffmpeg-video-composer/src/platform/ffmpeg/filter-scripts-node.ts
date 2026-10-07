import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ffmpegCompat, type FFmpegCompat } from '../../core/ffmpeg-version';
import { ffmpegVersionLine, versionFromLine } from './analyze-node';

// Linux caps a single exec argument at 128 KiB (MAX_ARG_STRLEN): a long filtergraph (many stepped or
// per-frame drawtext/drawbox filters) passed inline makes the spawn fail with E2BIG before FFmpeg even
// starts. Past this size the graph goes through a file instead, in the syntax the binary accepts:
// `-/vf graph.txt` from FFmpeg 7.0 (the only form FFmpeg 9 knows), `-filter_script:v graph.txt` before.
const MAX_INLINE_FILTER = 64 * 1024;

type OptionFileSyntax = FFmpegCompat['optionFiles'];

const SCRIPT_OPTIONS: Record<string, string> = {
  '-vf': '-filter_script:v',
  '-filter:v': '-filter_script:v',
  '-af': '-filter_script:a',
  '-filter:a': '-filter_script:a',
  '-filter_complex': '-filter_complex_script',
};

function fileOption(option: string, syntax: OptionFileSyntax): string {
  return syntax === 'slash' ? `-/${option.slice(1)}` : SCRIPT_OPTIONS[option];
}

function oversized(args: string[]): number[] {
  return args.flatMap((arg, index) =>
    index > 0 && Object.hasOwn(SCRIPT_OPTIONS, args[index - 1]) && arg.length > MAX_INLINE_FILTER ? [index] : []
  );
}

/** The option-file syntax of the `ffmpeg` at `binary` (memoized `-version`); unknown = current. */
export async function optionFileSyntaxOf(binary: string): Promise<OptionFileSyntax> {
  return ffmpegCompat(versionFromLine(await ffmpegVersionLine(binary))).optionFiles;
}

/**
 * Runs `run` with every oversized filtergraph argument moved into a temporary file. `syntax` is only
 * asked for when a graph is oversized, so short commands never pay for the version lookup.
 */
export async function withFilterScripts<T>(
  args: string[],
  run: (args: string[]) => Promise<T>,
  syntax: () => Promise<OptionFileSyntax> = () => optionFileSyntaxOf('ffmpeg')
): Promise<T> {
  const indexes = oversized(args);

  if (indexes.length === 0) return run(args);

  const form = await syntax();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'leclap-filters-'));

  try {
    const rewritten = [...args];
    const files = indexes.map((index, n) => ({ index, file: path.join(dir, `graph-${n}.txt`) }));

    await Promise.all(files.map(({ index, file }) => fs.writeFile(file, args[index], 'utf8')));

    for (const { index, file } of files) {
      rewritten[index - 1] = fileOption(args[index - 1], form);
      rewritten[index] = file;
    }

    return await run(rewritten);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
