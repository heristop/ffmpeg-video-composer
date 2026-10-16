import { defineCommand } from 'citty';
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { compareSnapshots, loadConfig, resolveStyleFfmpeg } from 'ffmpeg-video-composer';
import { setEngineLogLevel } from '../log.js';
import { atValues } from '../snapshot-args.js';
import { emit, emitFailure, renderOptions, snapshotArgs } from './snapshot.js';

// `leclap compare a.json b.json --at 3`: render every template and tile the same moment of each into one
// labelled grid (`<out>/compare-grid.png`), each frame also saved on its own.

/** A short, unique grid label per template: its file name, numbered when two share one. */
export function variantLabels(files: readonly string[]): string[] {
  const names = files.map((file) => path.basename(file, path.extname(file)));

  return names.map((name, i) =>
    names.indexOf(name) === i && names.lastIndexOf(name) === i ? name : `${name}-${i + 1}`
  );
}

/** ffmpeg args grabbing the reference's frame at `at` seconds, as wide as a compare tile. */
export function referenceFrameArgs(clip: string, at: number, out: string, width: number): string[] {
  return ['-v', 'error', '-y', '-ss', String(at), '-i', clip, '-frames:v', '1', '-vf', `scale=${width}:-2`, out];
}

/** Where the reference tile is saved: named like the variant tiles (`compare-<n>-<label>.png`). */
export function referenceTilePath(outDir: string): string {
  return path.join(outDir, 'compare-reference.png');
}

/** The reference's frame at the compared second, saved in `outDir`; fails when the clip ends before it. */
async function grabReference(clip: string, at: number, outDir: string, width: number) {
  const out = referenceTilePath(outDir);

  rmSync(out, { force: true });
  execFileSync(await resolveStyleFfmpeg(), referenceFrameArgs(clip, at, out, width), { stdio: 'pipe' });

  if (!existsSync(out)) throw new Error(`Reference has no frame at ${at.toFixed(2)}s: pick an earlier --at`);

  return { path: out, label: 'reference' };
}

export const compare = defineCommand({
  meta: { name: 'compare', description: 'Render several templates and tile the same moment of each in one grid' },
  args: {
    template: snapshotArgs.template,
    at: { type: 'string', description: 'The moment: seconds or a time reference (default 0)' },
    cols: { type: 'string', description: 'Grid columns (default: square-ish)' },
    reference: { type: 'string', description: 'A reference clip: its frame at --at becomes the first tile' },
    safe: snapshotArgs.safe,
    zoom: snapshotArgs.zoom,
    out: snapshotArgs.out,
    field: snapshotArgs.field,
    locale: snapshotArgs.locale,
    assets: snapshotArgs.assets,
    cache: snapshotArgs.cache,
    format: snapshotArgs.format,
    json: snapshotArgs.json,
  },
  async run({ args, rawArgs }) {
    setEngineLogLevel('silent');

    try {
      const files = [args.template, ...args._.filter((value) => value !== args.template)];

      if (files.length < 2) throw new Error('compare needs at least two templates');

      const labels = variantLabels(files);
      const variants = await Promise.all(
        files.map(async (file, i) => ({ label: labels[i], descriptor: await loadConfig(path.resolve(file)) }))
      );
      const cols = args.cols === undefined ? undefined : Number(args.cols);
      const options = { ...renderOptions(args, rawArgs), at: atValues(rawArgs, args.at).at(0) ?? 0 };
      const reference = args.reference === undefined ? undefined : path.resolve(args.reference);

      if (reference && !existsSync(reference)) throw new Error(`Reference not found: ${args.reference}`);

      // `--at` may be a time reference ("intro.end"): the engine resolves it on the first template and hands
      // the numeric second to `lead`, so the reference frame is grabbed at the same moment.
      const lead = reference
        ? (time: number, width: number) => grabReference(reference, time, options.outDir, width)
        : undefined;

      emit(await compareSnapshots(variants, { ...options, ...(cols && { cols }), ...(lead && { lead }) }), args.json);
    } catch (error) {
      emitFailure(error, args.json);
    }
  },
});
