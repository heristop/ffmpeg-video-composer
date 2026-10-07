// Node-only: frame snapshots of a native template — the agent's eyes. Renders the template through the
// real engine (the per-section cache in `cacheDir` makes a repeat look cost a copy, not an encode), then
// grabs one PNG per planned moment with an accurate seek, optionally shading a platform's UI zones and
// cropping a region, and tiles them into labelled contact sheets. Exported through the Node entry with
// the engine's compile() injected, like the rendered geometry check.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { container } from 'tsyringe';
import type { CompileReporter, ProjectConfig, TemplateDescriptor } from '@/core/types';
import { DEFAULT_FONT_ID, findFont } from '../core/fonts';
import { expandPartialsSafe } from '../core/partials';
import { resolveFormat } from '../core/formats/resolve';
import { resolvePlatform } from '../core/platforms';
import { snapshotMoments, type SnapshotMoment, type SnapshotPlan } from '../core/timing/snapshot-times';
import { videoTimeline, type VideoTimeline } from '../core/timing/video-timeline';
import type AbstractFFmpeg from '../platform/ffmpeg/AbstractFFmpeg';
import type AbstractFilesystem from '../platform/filesystem/AbstractFilesystem';
import { runWithConcurrency } from '../utils/concurrency';
import {
  frameArgs,
  safeZoneFilters,
  sheetArgs,
  toCommand,
  zoomFilter,
  type SheetInput,
  type SheetLayout,
  type SnapshotZoom,
} from './snapshot-commands';

export interface SnapshotEngine {
  compile(config: ProjectConfig, template: TemplateDescriptor, reporter?: CompileReporter): Promise<string | null>;
}

export interface SnapshotRenderOptions {
  /** Where the PNGs land (created when missing). */
  outDir: string;
  /** File name prefix of every PNG (default "frame"). */
  prefix?: string;
  assetsDir?: string;
  /** Per-section render cache, shared with `leclap render --cache` / compose renders. */
  cacheDir?: string;
  /** Parent of the scratch build directory, removed afterwards. Defaults to the OS temp dir. */
  workDir?: string;
  fields?: Record<string, string>;
  currentLocale?: string;
  userVideoPaths?: Record<string, string>;
  /** Format to look at (`formats[format]` + `$format` values); default: the template's own orientation. */
  format?: 'landscape' | 'portrait' | 'square';
}

export interface SnapshotOptions extends SnapshotPlan, SnapshotRenderOptions {
  /** Tile the frames into contact sheets of cols×rows (several sheets when there are more frames). */
  sheet?: SheetLayout;
  /** Shade the UI zones of this delivery platform (core/platforms.ts). */
  safe?: string;
  /** Crop every frame to this region. */
  zoom?: SnapshotZoom;
}

export interface SnapshotImage {
  path: string;
  width: number;
  height: number;
}

export interface SnapshotFrame extends SnapshotImage {
  time: number;
  label: string;
  section: string;
}

export interface SnapshotResult {
  frames: SnapshotFrame[];
  sheets: SnapshotImage[];
  /** Seconds of the whole video, from the timeline. */
  duration: number;
}

const FRAME_CONCURRENCY = 4;

// The engine's container is process-wide: two snapshots compiling at once would share its Project.
let queue: Promise<unknown> = Promise.resolve();

export function serially<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);

  queue = run.catch(() => {});

  return run;
}

/** Width and height from a PNG's IHDR chunk. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  return bytes.byteLength >= 24 ? { width: view.getUint32(16), height: view.getUint32(20) } : { width: 0, height: 0 };
}

async function imageOf(file: string): Promise<SnapshotImage> {
  return { path: file, ...pngSize(new Uint8Array(await fs.readFile(file))) };
}

/** A fresh scratch directory under `workDir` (created when missing) or the OS temp dir. */
export async function scratchDir(options: SnapshotRenderOptions, prefix: string): Promise<string> {
  const parent = options.workDir ?? os.tmpdir();

  await fs.mkdir(parent, { recursive: true });

  return fs.mkdtemp(path.join(parent, prefix));
}

function ffmpeg(): AbstractFFmpeg {
  return container.resolve<AbstractFFmpeg>('ffmpegAdapter');
}

/**
 * The template as it renders: partials expanded, then resolved to `format` (or its base format when it
 * declares `formats` / `$format` values). Throws on an unknown format or a bad format patch.
 */
export function asRendered(descriptor: TemplateDescriptor, format?: string): TemplateDescriptor {
  const expansion = expandPartialsSafe(descriptor);

  if (!expansion.ok) throw new Error(expansion.error.message);

  const resolved = resolveFormat(expansion.data as TemplateDescriptor, format);

  if (resolved.issues.length > 0) throw new Error(resolved.issues.map((issue) => issue.message).join('; '));

  return resolved.descriptor;
}

/** The template on video seconds, from its partial-expanded form. */
export function timelineOf(descriptor: TemplateDescriptor): VideoTimeline {
  const expansion = expandPartialsSafe(descriptor);

  if (!expansion.ok) throw new Error(expansion.error.message);

  return videoTimeline(expansion.data);
}

function projectConfig(buildDir: string, options: SnapshotRenderOptions): ProjectConfig {
  return {
    buildDir,
    assetsDir: options.assetsDir,
    cacheDir: options.cacheDir,
    fields: options.fields,
    currentLocale: options.currentLocale,
    userVideoPaths: options.userVideoPaths,
  };
}

/** Render the template into `buildDir` and return the video; throws with the engine's last error. */
export async function renderVideo(
  engine: SnapshotEngine,
  descriptor: TemplateDescriptor,
  buildDir: string,
  options: SnapshotRenderOptions
): Promise<string> {
  const failure = { message: 'the engine produced no output' };
  const reporter: CompileReporter = {
    onError: (error) => (failure.message = error.message.split('\n')[0]),
  };
  const output = await engine.compile(projectConfig(buildDir, options), descriptor, reporter);

  if (!output) throw new Error(`render failed: ${failure.message}`);

  return output;
}

/** Grab the frame at `time` of `video` into `out`, through `filters`. */
export async function grabFrame(video: string, time: number, out: string, filters: string[]): Promise<SnapshotImage> {
  await ffmpeg().execute(toCommand(frameArgs(video, time, out, filters)));

  return imageOf(out);
}

async function labelFont(): Promise<string | undefined> {
  try {
    const filesystem = container.resolve<AbstractFilesystem>('filesystemAdapter');

    return (await filesystem.resolveBundledFont(findFont(DEFAULT_FONT_ID)?.file ?? 'Rubik.ttf')) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Tile `inputs` into one sheet. Labels need drawtext; an FFmpeg without it (or without a usable font)
 * still gets the sheet, unlabelled.
 */
export async function buildSheet(inputs: SheetInput[], layout: SheetLayout, out: string): Promise<SnapshotImage> {
  try {
    await ffmpeg().execute(toCommand(sheetArgs(inputs, layout, out, await labelFont())));
  } catch {
    await ffmpeg().execute(toCommand(sheetArgs(inputs, layout, out, false)));
  }

  return imageOf(out);
}

function frameFilters(options: SnapshotOptions): string[] {
  const platform = options.safe === undefined ? undefined : resolvePlatform(options.safe);

  if (options.safe !== undefined && !platform) throw new Error(`unknown platform "${options.safe}" for safe`);

  return [...(platform ? safeZoneFilters(platform.safe) : []), ...(options.zoom ? [zoomFilter(options.zoom)] : [])];
}

function frameName(options: SnapshotRenderOptions, index: number, time: number): string {
  return path.join(
    options.outDir,
    `${options.prefix ?? 'frame'}-${String(index + 1).padStart(2, '0')}-${time.toFixed(2)}s.png`
  );
}

function sheetLabel(frame: SnapshotFrame, source: SnapshotMoment['source']): string {
  const base = `${frame.time.toFixed(2)}s ${frame.section}`;

  return source === 'at' && !/^[\d.]+s$/.test(frame.label) ? `${base} ${frame.label}` : base;
}

async function sheetsOf(frames: SnapshotFrame[], moments: SnapshotMoment[], options: SnapshotOptions) {
  const layout = options.sheet;

  if (!layout || frames.length === 0) return [];

  const page = layout.cols * layout.rows;
  const pages = Array.from({ length: Math.ceil(frames.length / page) }, (_, i) => i);
  const first = frames[0];
  const tileWidth = layout.tileWidth ?? 480;
  const tileHeight = Math.round((tileWidth * first.height) / Math.max(1, first.width) / 2) * 2;
  const prefix = options.prefix ?? 'frame';

  return runWithConcurrency(pages, 1, (index) => {
    const slice = frames.slice(index * page, (index + 1) * page);
    const inputs = slice.map((frame, i) => ({
      path: frame.path,
      label: sheetLabel(frame, moments[index * page + i].source),
    }));

    return buildSheet(
      inputs,
      { ...layout, tileWidth, tileHeight },
      path.join(options.outDir, `${prefix}-sheet-${index + 1}.png`)
    );
  });
}

async function snapshot(engine: SnapshotEngine, authored: TemplateDescriptor, options: SnapshotOptions) {
  const descriptor = asRendered(authored, options.format);
  const timeline = timelineOf(descriptor);
  const moments = snapshotMoments(descriptor, options, timeline);
  const filters = frameFilters(options);
  const root = await scratchDir(options, 'leclap-snapshot-');

  try {
    await fs.mkdir(options.outDir, { recursive: true });
    const video = await renderVideo(engine, descriptor, path.join(root, 'build'), options);
    const frames = await runWithConcurrency(moments, FRAME_CONCURRENCY, async (moment, i) => ({
      ...(await grabFrame(video, moment.time, frameName(options, i, moment.time), filters)),
      time: moment.time,
      label: moment.label,
      section: moment.section,
    }));

    return { frames, sheets: await sheetsOf(frames, moments, options), duration: timeline.duration };
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

/**
 * Render `descriptor` and grab a PNG at every planned moment (`at`, `atTransitions`, `perSection`; each
 * section's settled moment when none is given), plus contact sheets when `sheet` is set. Throws on an
 * unplaceable time, an unknown platform or a failed render.
 */
export function runSnapshots(
  descriptor: TemplateDescriptor,
  options: SnapshotOptions,
  engine: SnapshotEngine
): Promise<SnapshotResult> {
  return serially(() => snapshot(engine, descriptor, options));
}
