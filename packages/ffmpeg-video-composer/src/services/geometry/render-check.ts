// Node-only: the opt-in rendered geometry check. The static model never sees a pixel, so text over an
// image, under a grade or a look is judged only by whether it carries a box, outline or shadow. This
// renders the sections that hold text through the real engine — twice, the second time with every
// glyph's fill swapped for a probe colour — reads one frame of each at the moment its text rests, and
// measures how the glyphs contrast with what surrounds them (pixel-contrast.ts).
//
// Exported from the Node entry alone, like node-geometry.ts: it spawns FFmpeg and writes to disk. Its
// geometry imports are type-only or dynamic, so the lazy `import('./geometry')` in TemplateValidator
// still keeps the model out of the eager chunk.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { container } from 'tsyringe';
import type { CompileReporter, ProjectConfig, TemplateDescriptor as CoreDescriptor } from '@/core/types';
import { segmentOutputPath } from '../../director/section-infos';
import { runWithConcurrency } from '../../utils/concurrency';
import type AbstractFFmpeg from '../../platform/ffmpeg/AbstractFFmpeg';
import { FFmpegAvailability, type FFmpegDetectionResult } from '../../platform/ffmpeg/FFmpegDetector';
import type { TemplateDescriptor } from '../../schemas/template.schemas';
import type { FontLoader } from './bundled-font-loader';
import { ffmpegBinary, noDrawtextReason } from './drawtext-probe';
import type { Canvas } from './geometry-types';
import type { RgbFrame } from './pixel-contrast';
import type { RenderedResult, RenderTarget } from './render-findings';
import type { GeometryWarning } from './rules';

export interface RenderEngine {
  compile(config: ProjectConfig, template: CoreDescriptor, reporter?: CompileReporter): Promise<string | null>;
  detect(): Promise<FFmpegDetectionResult>;
  // Whether the FFmpeg binary at this path lists the drawtext filter (drawtext-probe.ts).
  supportsDrawtext(binary: string): Promise<boolean>;
}

export interface RenderCheckOptions {
  // Where the template's local assets resolve, as for a render (`leclap render --assets`).
  assetsDir?: string;
  // Parent of the scratch build directory, removed afterwards. Defaults to the OS temp dir.
  workDir?: string;
  currentLocale?: string;
  fields?: Record<string, string>;
  loadFont?: FontLoader;
  // Trust the template's raw filters (ProjectConfig.allowRawFilters); default: the allow-list.
  allowRawFilters?: boolean;
}

export interface RenderedGeometry {
  // The static findings, refined by the render, plus any contrast measured from pixels.
  warnings: GeometryWarning[];
  // How many pieces of text were measured from rendered pixels.
  measured: number;
  // Why nothing was rendered (no native FFmpeg, the render failed); `warnings` are then the static ones.
  unavailable?: string;
}

type Outcome = { ok: true } | { ok: false; reason: string };

// Only a native FFmpeg: the WASM build runs in-process and in memory, far too slow to render a
// template as part of a validation.
const NATIVE = new Set([FFmpegAvailability.SYSTEM, FFmpegAvailability.STATIC]);

const NO_FFMPEG = 'the rendered check needs a native FFmpeg (system or ffmpeg-static) — run `leclap diagnose`';

// The engine's container is process-wide: two checks rendering at once would share its Project and
// swap each other's FFmpeg adapter. The MCP server runs validations concurrently, so they queue.
let queue: Promise<unknown> = Promise.resolve();

function serially<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);

  queue = run.catch(() => {});

  return run;
}

// A failed compile returns null and reports why only through the log, so keep its last error line.
async function compileQuietly(
  engine: RenderEngine,
  config: ProjectConfig,
  template: TemplateDescriptor
): Promise<Outcome> {
  let lastError = 'the engine produced no output';
  const reporter: CompileReporter = {
    onLog: ({ level, message }) => {
      lastError = level === 'error' ? message.split('\n')[0] : lastError;
    },
  };
  const output = await engine.compile(config, template, reporter);

  return output ? { ok: true } : { ok: false, reason: `render failed: ${lastError}` };
}

// Every command of the probe render runs with its drawtext fills swapped; restored whatever happens.
async function withProbeFill<T>(rewrite: (command: string) => string, run: () => Promise<T>): Promise<T> {
  const base = container.resolve<AbstractFFmpeg>('ffmpegAdapter');
  const probe = Object.create(base) as AbstractFFmpeg;

  probe.execute = (command: string) => base.execute(rewrite(command));
  container.registerInstance('ffmpegAdapter', probe);

  try {
    return await run();
  } finally {
    container.registerInstance('ffmpegAdapter', base);
  }
}

// Frame reads are short FFmpeg runs of their own; a few at a time keeps a template with many captions
// from spawning one process per caption at once.
const FRAME_CONCURRENCY = 4;

// One frame of a segment as packed rgb24, or null when there is none at that time (a section shorter
// than the model assumed) or its size is not the canvas the boxes were measured on. `out` is unique
// per read: two captions resting at the same moment of one section would otherwise share a file.
async function grabFrame(video: string, atSec: number, canvas: Canvas, out: string): Promise<RgbFrame | null> {
  const adapter = container.resolve<AbstractFFmpeg>('ffmpegAdapter');

  try {
    await adapter.execute(`-y -ss ${atSec.toFixed(3)} -i "${video}" -frames:v 1 -f rawvideo -pix_fmt rgb24 "${out}"`);
    const data = new Uint8Array(await fs.readFile(out));

    return data.length === canvas.width * canvas.height * 3 ? { ...canvas, data } : null;
  } catch {
    return null;
  }
}

interface RenderDirs {
  real: string;
  probe: string;
}

function frameOf(target: RenderTarget, index: number, dir: string, canvas: Canvas): Promise<RgbFrame | null> {
  const video = segmentOutputPath(dir, target.sectionName);

  return grabFrame(video, target.offsetSec, canvas, path.join(dir, `frame-${index}.rgb`));
}

async function measureTarget(target: RenderTarget, index: number, dirs: RenderDirs, canvas: Canvas) {
  const { measureRenderedContrast } = await import('./pixel-contrast');
  const [real, probe] = await Promise.all([
    frameOf(target, index, dirs.real, canvas),
    frameOf(target, index, dirs.probe, canvas),
  ]);
  const contrast = real && probe ? measureRenderedContrast(real, probe, target.rect, target.ringPx) : null;

  return { target, contrast };
}

function measureAll(targets: RenderTarget[], dirs: RenderDirs, canvas: Canvas): Promise<RenderedResult[]> {
  return runWithConcurrency(targets, FRAME_CONCURRENCY, (target, index) => measureTarget(target, index, dirs, canvas));
}

function projectConfig(buildDir: string, options: RenderCheckOptions): ProjectConfig {
  return {
    buildDir,
    assetsDir: options.assetsDir,
    currentLocale: options.currentLocale,
    fields: options.fields,
    allowRawFilters: options.allowRawFilters,
  };
}

async function renderBoth(
  engine: RenderEngine,
  template: TemplateDescriptor,
  dirs: RenderDirs,
  options: RenderCheckOptions
): Promise<Outcome> {
  const { probeTextFill } = await import('./render-findings');
  const real = await compileQuietly(engine, projectConfig(dirs.real, options), template);

  if (!real.ok) {
    return real;
  }

  return withProbeFill(probeTextFill, () => compileQuietly(engine, projectConfig(dirs.probe, options), template));
}

// Why this engine cannot render the check, or null when it can. Every section it renders holds text,
// so an FFmpeg without drawtext would fail each one; asking its filter list first names the fix.
async function renderBlocker(engine: RenderEngine): Promise<string | null> {
  const detection = await engine.detect();
  const binary = NATIVE.has(detection.availability) ? ffmpegBinary(detection) : null;

  if (!binary) {
    return NO_FFMPEG;
  }

  return (await engine.supportsDrawtext(binary)) ? null : noDrawtextReason(binary);
}

async function check(
  descriptor: TemplateDescriptor,
  options: RenderCheckOptions,
  engine: RenderEngine
): Promise<RenderedGeometry> {
  const geometry = await import('./index');
  const findings = await import('./render-findings');
  const measured = await geometry.measureTemplate(descriptor, options.loadFont);
  const targets = findings.renderTargets(measured);
  const unrendered = geometry.finalizeFindings(geometry.staticFindings(measured));

  if (targets.length === 0) {
    return { warnings: unrendered, measured: 0 };
  }

  const unavailable = await renderBlocker(engine);

  if (unavailable) {
    return { warnings: unrendered, measured: 0, unavailable };
  }

  const root = await fs.mkdtemp(path.join(options.workDir ?? os.tmpdir(), 'leclap-render-check-'));
  const dirs = { real: path.join(root, 'real'), probe: path.join(root, 'probe') };

  try {
    const template = findings.renderDescriptor(measured.template, new Set(targets.map((t) => t.sectionName)));
    const rendered = await renderBoth(engine, template, dirs, options);

    if (!rendered.ok) {
      return { warnings: unrendered, measured: 0, unavailable: rendered.reason };
    }

    const results = await measureAll(targets, dirs, measured.canvas);

    return {
      warnings: geometry.finalizeFindings(findings.mergeRenderedFindings(measured, results)),
      measured: results.filter((result) => result.contrast !== null).length,
    };
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

/**
 * Render the sections holding text and measure it from pixels. Costs a real render of those sections,
 * twice — seconds, not milliseconds — so it is opt-in (`leclap validate --render`, `render: true` on
 * the MCP tool). Advisory like the static check: a missing FFmpeg or a failed render degrades to the
 * static findings and says why in `unavailable`, never a throw.
 */
export function runRenderCheck(
  descriptor: TemplateDescriptor,
  options: RenderCheckOptions,
  engine: RenderEngine
): Promise<RenderedGeometry> {
  return serially(() =>
    check(descriptor, options, engine).catch((error: unknown) => degrade(descriptor, options, error))
  );
}

// Anything that lands here is a bug rather than an expected failure (those return `unavailable`), but
// validation is advisory: fall back to the static findings, and say the render did not happen.
async function degrade(
  descriptor: TemplateDescriptor,
  options: RenderCheckOptions,
  error: unknown
): Promise<RenderedGeometry> {
  const { collectGeometryWarnings } = await import('./index');
  const warnings = await collectGeometryWarnings(descriptor, options.loadFont).catch(() => []);
  const reason = error instanceof Error ? error.message : String(error);

  return { warnings, measured: 0, unavailable: `rendered check failed: ${reason}` };
}
