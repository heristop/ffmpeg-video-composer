import { defineCommand } from 'citty';
import fs from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import {
  compile,
  loadConfig,
  type CompileReporter,
  type ProjectConfig,
  type QcReport,
  type RenderManifest,
} from 'ffmpeg-video-composer';
import { setEngineLogLevel } from '../log.js';
import { LiveRenderer } from '../render-progress.js';
import { buildProjectConfig, collectRepeated, withOrientation, type RenderFlags } from '../render-args.js';
import { summaryLine, safeSize } from '../render-format.js';
import { watchPaths } from '../watch.js';
import { assertOutputIsNotInput, finalizeOutput, writeManifest } from '../render-manifest.js';
import { fail, hint } from '../ui.js';
import { compileFailure, errorMessage, printErrorHints } from '../render-errors.js';
import { printHeader } from '../render-header.js';
import { failedChecks, reportQc } from '../render-qc.js';
import { FORMAT_ARGS, multiFormatRun, runFormats } from '../render-formats.js';

// Everything a render pass needs, assembled once from the CLI flags.
interface RenderOptions {
  templatePath: string;
  projectConfig: ProjectConfig & { buildDir: string };
  /** `--orientation` override, applied to the loaded descriptor each compile (watch re-loads). */
  orientation?: string;
  outputAbs?: string;
  quiet: boolean;
  json: boolean;
  verbose: boolean;
  watch: boolean;
  /** `--manifest`: write `<output>.manifest.json` next to the video. */
  manifest: boolean;
  /** The last render's QC report (`--qc`), read after the render settles. */
  qc?: QcReport;
}

// Every value of a repeatable flag. They come from raw argv, because citty keeps only the last value
// of a repeated flag; programmatic callers that invoke run() without rawArgs fall back to the parsed one.
function repeatedFlag(rawArgs: readonly string[] | undefined, parsed: unknown, name: string): string[] {
  if (rawArgs) return collectRepeated(rawArgs, name);

  return [parsed].flat().filter((value): value is string => typeof value === 'string');
}

// Fail with a machine-readable `{ok:false,error}` on stdout in --json mode (so a consumer parsing
// stdout still gets the documented shape), or a coloured human error on stderr otherwise. Exits 1.
function emitError(message: string, json: boolean): never {
  if (json) process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`);

  if (!json) console.error(fail(message));

  return process.exit(1);
}

async function ensureTemplateExists(templatePath: string, json: boolean): Promise<void> {
  try {
    await fs.access(templatePath);
  } catch {
    emitError(`Template not found: ${json ? templatePath : pc.bold(templatePath)}`, json);
  }
}

// Re-load the template (so watch picks up edits), compile, and place the output. Throws on failure,
// with the engine's own cause (e.g. which section failed) when it reported one.
async function compileOnce(opts: RenderOptions, reporter?: CompileReporter): Promise<string> {
  const template = withOrientation(await loadConfig(opts.templatePath), opts.orientation);
  const captured: { error?: Error; manifest?: RenderManifest } = {};
  const result = await compile(opts.projectConfig, template, {
    ...reporter,
    onError: (error) => {
      captured.error = error;
    },
    onQc: (report) => (opts.qc = report),
    ...(opts.manifest && { onManifest: (manifest: RenderManifest) => (captured.manifest = manifest) }),
  });

  if (!result) throw compileFailure(captured.error);

  const output = await finalizeOutput(result, opts.outputAbs);

  if (captured.manifest) writeManifest(output, captured.manifest);

  return output;
}

export const render = defineCommand({
  meta: { name: 'render', description: 'Compile a video from a template JSON' },
  args: {
    template: { type: 'positional', description: 'Path to a template JSON file', required: true },
    output: { type: 'string', alias: 'o', description: 'Copy the rendered video to this path' },
    field: { type: 'string', description: 'Set a template variable: --field key=value (repeatable)' },
    set: { type: 'string', description: 'Set a declared field (global.fields): --set name=value (repeatable)' },
    video: { type: 'string', description: 'Map a project_video section to a file: --video section=path (repeatable)' },
    locale: { type: 'string', description: 'Locale for translated text (e.g. en, fr)' },
    orientation: { type: 'string', description: 'Override orientation: landscape | portrait | square' },
    ...FORMAT_ARGS,
    assets: { type: 'string', description: 'Assets directory (default ./assets)' },
    build: { type: 'string', description: 'Build/output directory (default ./build)' },
    watch: { type: 'boolean', description: 'Re-render when the template or its assets change', default: false },
    quiet: { type: 'boolean', alias: 'q', description: 'Print only the final result', default: false },
    json: { type: 'boolean', description: 'Emit a machine-readable JSON result', default: false },
    verbose: { type: 'boolean', description: 'Stream the underlying engine logs', default: false },
    manifest: {
      type: 'boolean',
      description: 'Write <output>.manifest.json (digests for leclap verify)',
      default: false,
    },
    deterministic: {
      type: 'boolean',
      description: 'Bit-exact muxing + pinned encoder threads (--no-deterministic to disable)',
      default: true,
    },
    qc: { type: 'boolean', description: 'Check the output (format + content); exit 1 on a failure', default: false },
    cache: { type: 'string', description: 'Per-section render cache directory' },
    downloadModel: { type: 'boolean', description: 'Allow the one-time whisper model download', default: false },
  },
  async run({ args, rawArgs }) {
    const json = args.json;
    const quiet = args.quiet || json;
    const verbose = args.verbose && !json;

    // --verbose streams the engine's own logs to stdout; otherwise the CLI owns the terminal (engine
    // silent, logs teed to a file + live region). JSON mode is always silent.
    setEngineLogLevel(verbose ? 'info' : 'silent');
    process.env.LECLAP_CLI_UI = '1';

    // subtitles.transcribe resolves during the render (whisper.cpp); the model download is opt-in.
    if (args.downloadModel) process.env.LECLAP_WHISPER_DOWNLOAD = '1';

    await ensureTemplateExists(args.template, json);

    const flags: RenderFlags = {
      field: repeatedFlag(rawArgs, args.field, 'field'),
      set: repeatedFlag(rawArgs, args.set, 'set'),
      video: repeatedFlag(rawArgs, args.video, 'video'),
      locale: args.locale,
      orientation: args.orientation,
      format: args.format,
      assets: args.assets,
      build: args.build,
      deterministic: args.deterministic,
      qc: args.qc,
      cache: args.cache,
    };

    const mode = { quiet, json, verbose, watch: args.watch, output: args.output, manifest: args.manifest };
    const opts = buildOptions(args.template, flags, mode);

    await fs.mkdir(opts.projectConfig.buildDir, { recursive: true });

    // --formats: one render per format, each to <output>-<format>.mp4 (render-formats.ts).
    if (args.formats) return runFormats(args.formats, multiFormatRun(opts, compileOnce));

    await dispatch(opts);
  },
});

interface ModeFlags {
  quiet: boolean;
  json: boolean;
  verbose: boolean;
  watch: boolean;
  output?: string;
  manifest: boolean;
}

// Assemble RenderOptions; surfaces a bad `--field`/`--video` value as a clean error + exit.
function buildOptions(templatePath: string, flags: RenderFlags, mode: ModeFlags): RenderOptions {
  try {
    const outputAbs = mode.output ? path.resolve(process.cwd(), mode.output) : undefined;
    const projectConfig = buildProjectConfig(process.cwd(), flags);
    assertOutputIsNotInput(outputAbs, [templatePath, ...Object.values(projectConfig.userVideoPaths ?? {})]);

    return {
      templatePath,
      projectConfig,
      orientation: flags.orientation,
      outputAbs,
      quiet: mode.quiet,
      json: mode.json,
      verbose: mode.verbose,
      watch: mode.watch,
      manifest: mode.manifest,
    };
  } catch (error) {
    return emitError(errorMessage(error), mode.json);
  }
}

async function dispatch(opts: RenderOptions): Promise<void> {
  if (opts.json) {
    await renderJson(opts);

    return;
  }

  if (!opts.quiet) {
    await printHeader(opts.projectConfig, process.cwd());
  }

  // --watch ignores non-interactive sessions (nothing to repaint); fall through to a single render.
  if (opts.watch && process.stdout.isTTY) {
    await renderWatch(opts);

    return;
  }

  await (opts.verbose ? renderVerbose(opts) : renderWithReporter(opts));
}

// JSON mode: one machine-readable object, no colour/progress. Exit 1 on failure.
async function renderJson(opts: RenderOptions): Promise<void> {
  const startedAt = Date.now();

  try {
    const output = await compileOnce(opts);
    const failed = failedChecks(opts.qc);
    const result = { ok: failed.length === 0, output, bytes: safeSize(output), durationMs: Date.now() - startedAt };
    const qc = opts.qc && {
      qc: opts.qc,
      ...(failed.length > 0 && { error: `output QC failed: ${failed.join(', ')}` }),
    };
    process.stdout.write(`${JSON.stringify({ ...result, ...qc })}\n`);

    if (failed.length > 0) process.exit(1);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: errorMessage(error) })}\n`);
    process.exit(1);
  }
}

async function renderVerbose(opts: RenderOptions): Promise<void> {
  console.log(`Rendering ${pc.bold(path.basename(opts.templatePath))}…`);
  const startedAt = Date.now();

  try {
    const output = await compileOnce(opts);
    console.log(summaryLine(output, startedAt, process.cwd(), Date.now()));
  } catch (error) {
    printErrorHints(error);
    process.exit(1);
  }

  if (reportQc(opts.qc, false)) process.exit(1);
}

interface ReporterBundle {
  reporter: CompileReporter;
  flushLog: () => void;
  logRel: string;
}

// Build the log-teeing reporter + live region for a non-verbose render.
function makeReporter(opts: RenderOptions, live: LiveRenderer | null): ReporterBundle {
  const logPath = path.join(opts.projectConfig.buildDir, 'render.log');
  const logLines: string[] = [];

  const reporter: CompileReporter = {
    onProgress: (fraction) => live?.update(fraction),
    onLog: ({ level, message }) => {
      logLines.push(`${level.padEnd(5)} ${message}`);

      if (level !== 'debug') live?.pushLog(message);
    },
  };

  function flushLog(): void {
    try {
      writeFileSync(logPath, `${logLines.join('\n')}\n`);
    } catch {
      // A log-file write failure must never mask the render result.
    }
  }

  return { reporter, flushLog, logRel: path.relative(process.cwd(), logPath) };
}

async function renderWithReporter(opts: RenderOptions): Promise<void> {
  const label = `Rendering ${pc.bold(path.basename(opts.templatePath))}…`;
  const live = process.stdout.isTTY && !opts.quiet ? new LiveRenderer(label) : null;
  const { reporter, flushLog, logRel } = makeReporter(opts, live);
  const startedAt = Date.now();

  if (live) live.start();

  if (!live && !opts.quiet) console.log(label);

  try {
    const output = await compileOnce(opts, reporter);
    flushLog();
    finishSuccess(output, startedAt, live, opts.quiet ? null : logRel);
  } catch (error) {
    flushLog();
    live?.finishError();

    if (!opts.quiet) console.error(hint(`  full log → ${logRel}`));

    printErrorHints(error);
    process.exit(1);
  }

  if (reportQc(opts.qc, opts.quiet)) process.exit(1);
}

// Print the success summary, optionally with the log-path hint, via the live region when present.
function finishSuccess(output: string, startedAt: number, live: LiveRenderer | null, logRel: string | null): void {
  const summary = summaryLine(output, startedAt, process.cwd(), Date.now());
  const block = logRel ? `${summary}\n${hint(`  full log → ${logRel}`)}` : summary;

  if (live) {
    live.finishSuccess(block);

    return;
  }

  console.log(block);
}

// --watch: render once, then re-render on template/asset changes until Ctrl-C. A failed pass is
// reported but never exits, so the loop survives typos while you edit.
async function renderWatch(opts: RenderOptions): Promise<void> {
  let busy = false;
  let queued = false;

  async function pass(): Promise<void> {
    if (busy) {
      queued = true;

      return;
    }

    busy = true;

    try {
      await watchPass(opts);
    } finally {
      busy = false;

      if (queued) {
        queued = false;
        pass().catch(() => {});
      }
    }
  }

  await pass();

  const targets = [opts.templatePath, opts.projectConfig.assetsDir].filter((p): p is string => Boolean(p));
  const stopWatching = watchPaths(targets, () => {
    pass().catch(() => {});
  });

  // Tear the watchers down on Ctrl-C so the process can exit cleanly instead of leaking them.
  process.once('SIGINT', () => {
    stopWatching();
    process.exit(130);
  });

  console.log(hint(`  watching ${pc.bold(path.basename(opts.templatePath))} + assets — ctrl-c to stop`));
}

// A single watch render: live region, but errors are printed and swallowed (the watcher keeps running).
async function watchPass(opts: RenderOptions): Promise<void> {
  const label = `Rendering ${pc.bold(path.basename(opts.templatePath))}…`;
  const live = process.stdout.isTTY ? new LiveRenderer(label) : null;
  const { reporter, flushLog } = makeReporter(opts, live);
  const startedAt = Date.now();

  if (live) live.start();

  try {
    const output = await compileOnce(opts, reporter);
    flushLog();
    finishSuccess(output, startedAt, live, null);
    reportQc(opts.qc, false);
  } catch (error) {
    flushLog();
    live?.finishError();
    console.error(fail(errorMessage(error)));
  }
}
