import { defineCommand } from 'citty';
import path from 'node:path';
import {
  loadConfig,
  lookSnapshots,
  parseSheet,
  renderSnapshots,
  type CompareResult,
  type SheetLayout,
  type SnapshotResult,
} from 'ffmpeg-video-composer';
import { setEngineLogLevel } from '../log.js';
import { parseKeyValues, collectRepeated } from '../render-args.js';
import { resolveAssetsDir } from '../resolve-assets-dir.js';
import { atValues, defaultCacheDir, parseZoom } from '../snapshot-args.js';
import { fail, hint, success } from '../ui.js';

// `leclap snapshot`: render a template and save still frames of it as PNGs — explicit moments, both
// sides of every cut, each section once it has settled — optionally tiled into contact sheets, with a
// platform's UI zones shaded or a region cropped. `--looks` renders the moment once per LOOK preset.

export const snapshotArgs = {
  template: { type: 'positional', description: 'Path to a template JSON file', required: true },
  at: {
    type: 'string',
    description: 'Moments, comma-separated or repeated: seconds or "intro.end", "beat:8", "50%", "cue:drop"',
  },
  'at-transitions': { type: 'boolean', description: 'Each cut, 0.1 s before and 0.2 s after', default: false },
  'per-section': { type: 'boolean', description: 'Each section once its entrances have landed', default: false },
  sheet: { type: 'string', description: 'Tile the frames into COLSxROWS contact sheets, e.g. 3x2' },
  safe: { type: 'string', description: 'Shade a platform UI zones: tiktok, reels, shorts, youtube…' },
  zoom: { type: 'string', description: 'Crop to x,y,w,h (fractions of the frame, or pixels)' },
  looks: { type: 'boolean', description: 'Tile the first --at moment once per LOOK preset', default: false },
  out: { type: 'string', description: 'Output directory for the PNGs (default ./frames)' },
  field: { type: 'string', description: 'Set a template variable: --field key=value (repeatable)' },
  video: { type: 'string', description: 'Map a project_video section to a file: --video section=path' },
  locale: { type: 'string', description: 'Locale for translated text (e.g. en, fr)' },
  assets: { type: 'string', description: 'Assets directory (default ./assets)' },
  cache: { type: 'string', description: 'Per-section render cache (default: a shared temp directory)' },
  format: { type: 'string', description: 'Look at one format of the template: landscape | portrait | square' },
  json: { type: 'boolean', description: 'Emit a machine-readable JSON result', default: false },
} as const;

interface SnapshotFlags {
  template: string;
  sheet?: string;
  safe?: string;
  zoom?: string;
  out?: string;
  locale?: string;
  assets?: string;
  cache?: string;
  format?: string;
}

/** Engine options shared by `snapshot` and `compare`, from the flags. */
export function renderOptions(args: SnapshotFlags, rawArgs: readonly string[] | undefined) {
  const videos = parseKeyValues(rawArgs ? collectRepeated(rawArgs, 'video') : [], 'video');

  return {
    outDir: path.resolve(args.out ?? 'frames'),
    assetsDir: args.assets ? path.resolve(args.assets) : resolveAssetsDir(process.cwd()),
    cacheDir: path.resolve(args.cache ?? defaultCacheDir()),
    fields: parseKeyValues(rawArgs ? collectRepeated(rawArgs, 'field') : [], 'field'),
    currentLocale: args.locale,
    userVideoPaths: Object.fromEntries(Object.entries(videos).map(([name, file]) => [name, path.resolve(file)])),
    safe: args.safe,
    zoom: parseZoom(args.zoom),
    ...(args.format !== undefined && { format: formatName(args.format) }),
  };
}

const FORMATS = ['landscape', 'portrait', 'square'] as const;

/** `--format` checked against the engine's format names. */
export function formatName(text: string): (typeof FORMATS)[number] {
  const found = FORMATS.find((name) => name === text);

  if (!found) throw new Error(`--format expects ${FORMATS.join(' | ')}, got "${text}"`);

  return found;
}

function sheetLayout(text: string): SheetLayout {
  const layout = parseSheet(text);

  if (!layout) throw new Error(`--sheet expects COLSxROWS (e.g. 3x2), got "${text}"`);

  return layout;
}

/** One line per PNG written, sheets last. */
export function snapshotLines(result: SnapshotResult | CompareResult): string[] {
  const sheets = 'sheets' in result ? result.sheets : [result.sheet];

  return [
    success(`Saved ${result.frames.length} frame${result.frames.length === 1 ? '' : 's'}`),
    ...result.frames.map((frame) =>
      hint(`  ${frame.time.toFixed(2)}s  ${frame.section}  ${frame.label}  ${frame.path}`)
    ),
    ...sheets.map((sheet) => hint(`  sheet ${sheet.width}×${sheet.height}  ${sheet.path}`)),
  ];
}

export function emit(result: SnapshotResult | CompareResult, json: boolean): void {
  process.stdout.write(json ? `${JSON.stringify(result)}\n` : `${snapshotLines(result).join('\n')}\n`);
}

export function emitFailure(error: unknown, json: boolean): void {
  const message = error instanceof Error ? error.message : String(error);

  process.exitCode = 1;

  if (json) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`);

    return;
  }

  console.error(fail(message));
}

export const snapshot = defineCommand({
  meta: { name: 'snapshot', description: 'Render a template and save still frames (PNG) of chosen moments' },
  args: snapshotArgs,
  async run({ args, rawArgs }) {
    setEngineLogLevel('silent');

    try {
      const descriptor = await loadConfig(path.resolve(args.template));
      const at = atValues(rawArgs, args.at);
      const options = renderOptions(args, rawArgs);
      const result = args.looks
        ? await lookSnapshots(descriptor, { ...options, at: at.at(0) ?? 0 })
        : await renderSnapshots(descriptor, {
            ...options,
            at,
            atTransitions: args['at-transitions'],
            perSection: args['per-section'],
            ...(args.sheet !== undefined && { sheet: sheetLayout(args.sheet) }),
          });

      emit(result, args.json);
    } catch (error) {
      emitFailure(error, args.json);
    }
  },
});
