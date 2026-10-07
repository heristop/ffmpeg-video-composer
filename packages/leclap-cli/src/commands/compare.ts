import { defineCommand } from 'citty';
import path from 'node:path';
import { compareSnapshots, loadConfig } from 'ffmpeg-video-composer';
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

export const compare = defineCommand({
  meta: { name: 'compare', description: 'Render several templates and tile the same moment of each in one grid' },
  args: {
    template: snapshotArgs.template,
    at: { type: 'string', description: 'The moment: seconds or a time reference (default 0)' },
    cols: { type: 'string', description: 'Grid columns (default: square-ish)' },
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

      emit(await compareSnapshots(variants, { ...options, ...(cols && { cols }) }), args.json);
    } catch (error) {
      emitFailure(error, args.json);
    }
  },
});
