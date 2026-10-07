import path from 'node:path';
import {
  FORMAT_NAMES,
  declaredFormats,
  isFormatName,
  loadConfig,
  type FormatName,
  type ProjectConfig,
} from 'ffmpeg-video-composer';
import { safeSize, summaryLine } from './render-format.js';
import { errorMessage, printErrorHints } from './render-errors.js';

// `leclap render --formats all|landscape,portrait`: one story, one render per format, each to
// `<output>-<format>.mp4`. Pure helpers (flag parsing, output naming) plus the loop, which takes the
// single-format compile as a callback so it never imports the render command back.

/**
 * The formats `--formats` asks for: `all` is every format the template declares (its base orientation,
 * each `formats` key, each format a `$format` value names); otherwise a comma-separated list.
 */
export function parseFormatsFlag(value: string, template: unknown): FormatName[] {
  if (value.trim() === 'all') return declaredFormats(template);

  const names = [
    ...new Set(
      value
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
    ),
  ];
  const unknown = names.filter((name) => !isFormatName(name));

  if (names.length === 0 || unknown.length > 0) {
    throw new Error(`--formats expects all or a list of ${FORMAT_NAMES.join(', ')}, got "${value}"`);
  }

  return FORMAT_NAMES.filter((name) => names.includes(name));
}

/** `--format` value, checked against the engine's formats. */
export function parseFormatFlag(value: string): FormatName {
  if (!isFormatName(value)) throw new Error(`--format expects ${FORMAT_NAMES.join(' | ')}, got "${value}"`);

  return value;
}

/**
 * Where one format of a multi-format render goes: `<output>-<format><ext>` (`.mp4` when the output has
 * no extension), or `<cwd>/<template name>-<format>.mp4` without `--output`.
 */
export function formatOutputPath(
  output: string | undefined,
  templatePath: string,
  format: FormatName,
  cwd: string
): string {
  const base = output ?? path.resolve(cwd, `${path.basename(templatePath, path.extname(templatePath))}.mp4`);
  const ext = path.extname(base) || '.mp4';
  const stem = path.extname(base) ? base.slice(0, -ext.length) : base;

  return `${stem}-${format}${ext}`;
}

export interface FormatRender {
  format: FormatName;
  output: string;
}

/** Render each format in turn (they share the build directory), stopping at the first failure. */
export async function renderEachFormat(
  formats: readonly FormatName[],
  outputFor: (format: FormatName) => string,
  compileFormat: (format: FormatName, output: string) => Promise<string>
): Promise<FormatRender[]> {
  // Sequential on purpose: the formats share one build directory.
  return formats.reduce<Promise<FormatRender[]>>(async (previous, format) => {
    const rendered = await previous;

    return [...rendered, { format, output: await compileFormat(format, outputFor(format)) }];
  }, Promise.resolve([]));
}

/** The `render` flags that pick formats (spread into the command's args). */
export const FORMAT_ARGS = {
  format: { type: 'string', description: 'Render one format of the template: landscape | portrait | square' },
  formats: {
    type: 'string',
    description: 'Render several formats, each to <output>-<format>.mp4: all | landscape,portrait,square',
  },
} as const;

export interface MultiFormatRun {
  templatePath: string;
  outputAbs?: string;
  json: boolean;
  quiet: boolean;
  /** Compile one format and place it at `output`; resolves to the path written. */
  compile: (format: FormatName, output: string) => Promise<string>;
}

interface SingleRenderOptions {
  templatePath: string;
  outputAbs?: string;
  json: boolean;
  quiet: boolean;
  projectConfig: ProjectConfig;
}

/** The multi-format run of a single-format render: each format compiles with `projectConfig.format` set. */
export function multiFormatRun<O extends SingleRenderOptions>(
  opts: O,
  compileOnce: (opts: O) => Promise<string>
): MultiFormatRun {
  return {
    templatePath: opts.templatePath,
    outputAbs: opts.outputAbs,
    json: opts.json,
    quiet: opts.quiet,
    compile: (format, outputAbs) =>
      compileOnce({ ...opts, outputAbs, projectConfig: { ...opts.projectConfig, format } }),
  };
}

function report(rendered: FormatRender[], startedAt: number, run: MultiFormatRun): void {
  if (run.json) {
    const outputs = rendered.map((entry) => ({ ...entry, bytes: safeSize(entry.output) }));
    process.stdout.write(`${JSON.stringify({ ok: true, outputs, durationMs: Date.now() - startedAt })}\n`);

    return;
  }

  for (const entry of rendered) {
    console.log(`${entry.format.padEnd(9)} ${summaryLine(entry.output, startedAt, process.cwd(), Date.now())}`);
  }
}

/** `--formats`: render every requested format, report each output; exit 1 on the first failure. */
export async function runFormats(flag: string, run: MultiFormatRun): Promise<void> {
  const startedAt = Date.now();

  try {
    const formats = parseFormatsFlag(flag, await loadConfig(run.templatePath));

    if (!run.quiet) console.log(`Rendering ${formats.join(', ')} of ${path.basename(run.templatePath)}…`);

    const rendered = await renderEachFormat(
      formats,
      (format) => formatOutputPath(run.outputAbs, run.templatePath, format, process.cwd()),
      run.compile
    );

    report(rendered, startedAt, run);
  } catch (error) {
    if (run.json) process.stdout.write(`${JSON.stringify({ ok: false, error: errorMessage(error) })}\n`);

    if (!run.json) printErrorHints(error);

    process.exit(1);
  }
}
