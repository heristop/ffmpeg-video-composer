import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Linux caps a single exec argument at 128 KiB (MAX_ARG_STRLEN): a long filtergraph (many stepped or
// per-frame drawtext/drawbox filters) passed inline makes the spawn fail with E2BIG before FFmpeg even
// starts. Past this size the graph goes through a script file instead; `-filter_script:*` and
// `-filter_complex_script` are read the same way on FFmpeg 6 through 8.
const MAX_INLINE_FILTER = 64 * 1024;

const SCRIPT_OPTIONS: Record<string, string> = {
  '-vf': '-filter_script:v',
  '-filter:v': '-filter_script:v',
  '-af': '-filter_script:a',
  '-filter:a': '-filter_script:a',
  '-filter_complex': '-filter_complex_script',
};

function oversized(args: string[]): number[] {
  return args.flatMap((arg, index) =>
    index > 0 && Object.hasOwn(SCRIPT_OPTIONS, args[index - 1]) && arg.length > MAX_INLINE_FILTER ? [index] : []
  );
}

/** Runs `run` with every oversized filtergraph argument moved into a temporary script file. */
export async function withFilterScripts<T>(args: string[], run: (args: string[]) => Promise<T>): Promise<T> {
  const indexes = oversized(args);

  if (indexes.length === 0) return run(args);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'leclap-filters-'));

  try {
    const rewritten = [...args];
    const files = indexes.map((index, n) => ({ index, file: path.join(dir, `graph-${n}.txt`) }));

    await Promise.all(files.map(({ index, file }) => fs.writeFile(file, args[index], 'utf8')));

    for (const { index, file } of files) {
      rewritten[index - 1] = SCRIPT_OPTIONS[args[index - 1]];
      rewritten[index] = file;
    }

    return await run(rewritten);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
