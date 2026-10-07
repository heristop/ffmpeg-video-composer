// Node-only: one moment of several renders side by side in one labelled grid. `runCompare` renders each
// variant template and grabs the same moment of each; `runLooks` renders the section on screen at that
// moment once per LOOK preset (alone, so a dozen grades cost a dozen short renders, not a dozen videos).
import fs from 'node:fs/promises';
import path from 'node:path';
import type { TemplateDescriptor } from '@/core/types';
import { expandPartialsSafe } from '../core/partials';
import { resolvePlatform } from '../core/platforms';
import { resolveTimeRefs } from '../core/timing/resolve';
import { resolveSnapshotTime, snapTime, type SnapshotTime } from '../core/timing/snapshot-times';
import { sectionAt } from '../core/timing/video-timeline';
import { runWithConcurrency } from '../utils/concurrency';
import { LOOK_PRESETS } from '../schemas/effects-visual.schemas';
import { safeZoneFilters, zoomFilter, type SnapshotZoom } from './snapshot-commands';
import {
  asRendered,
  buildSheet,
  grabFrame,
  renderVideo,
  scratchDir,
  serially,
  timelineOf,
  type SnapshotEngine,
  type SnapshotFrame,
  type SnapshotImage,
  type SnapshotRenderOptions,
} from './snapshot-node';

export interface CompareVariant {
  label: string;
  descriptor: TemplateDescriptor;
}

export interface CompareOptions extends SnapshotRenderOptions {
  /** The moment to compare: seconds or a whole-video time reference, read on each variant. */
  at: SnapshotTime;
  safe?: string;
  zoom?: SnapshotZoom;
  /** Grid columns (default: the square root of the variant count, rounded up). */
  cols?: number;
  tileWidth?: number;
}

export interface CompareResult {
  frames: SnapshotFrame[];
  sheet: SnapshotImage;
}

type Bag = Record<string, unknown>;

function filtersOf(options: CompareOptions): string[] {
  const platform = options.safe === undefined ? undefined : resolvePlatform(options.safe);

  if (options.safe !== undefined && !platform) throw new Error(`unknown platform "${options.safe}" for safe`);

  return [...(platform ? safeZoneFilters(platform.safe) : []), ...(options.zoom ? [zoomFilter(options.zoom)] : [])];
}

function slug(label: string): string {
  return label.replaceAll(/[^\w-]+/g, '-').slice(0, 40) || 'variant';
}

async function variantFrame(
  engine: SnapshotEngine,
  variant: CompareVariant,
  index: number,
  root: string,
  options: CompareOptions
): Promise<SnapshotFrame> {
  const descriptor = asRendered(variant.descriptor, options.format);
  const timeline = timelineOf(descriptor);
  const time = snapTime(resolveSnapshotTime(options.at, descriptor, timeline), timeline);
  const video = await renderVideo(engine, descriptor, path.join(root, `variant-${index}`), options);
  const out = path.join(options.outDir, `${options.prefix ?? 'compare'}-${index + 1}-${slug(variant.label)}.png`);
  const image = await grabFrame(video, time, out, filtersOf(options));

  return { ...image, time, label: variant.label, section: sectionAt(timeline, time)?.name ?? '' };
}

async function compare(engine: SnapshotEngine, variants: CompareVariant[], options: CompareOptions) {
  if (variants.length === 0) throw new Error('compare needs at least one variant');

  const root = await scratchDir(options, 'leclap-compare-');

  try {
    await fs.mkdir(options.outDir, { recursive: true });
    // One at a time: every render already uses the machine, and the engine's container is shared.
    const frames = await runWithConcurrency(variants, 1, (variant, index) =>
      variantFrame(engine, variant, index, root, options)
    );

    const cols = Math.max(1, options.cols ?? Math.ceil(Math.sqrt(frames.length)));
    const tileWidth = options.tileWidth ?? 480;
    const first = frames[0];
    const tileHeight = Math.round((tileWidth * first.height) / Math.max(1, first.width) / 2) * 2;
    const inputs = frames.map((frame) => ({ path: frame.path, label: `${frame.label} ${frame.time.toFixed(2)}s` }));
    const layout = { cols, rows: Math.ceil(frames.length / cols), tileWidth, tileHeight };
    const sheet = await buildSheet(
      inputs,
      layout,
      path.join(options.outDir, `${options.prefix ?? 'compare'}-grid.png`)
    );

    return { frames, sheet };
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

/** Render every variant and tile the same moment of each into one labelled grid. */
export function runCompare(
  variants: CompareVariant[],
  options: CompareOptions,
  engine: SnapshotEngine
): Promise<CompareResult> {
  return serially(() => compare(engine, variants, options));
}

/**
 * The one section on screen at `time`, alone: time references resolved on the whole video first (so
 * "beat:8" keeps its place), no transitions and no music.
 */
export function isolateSection(descriptor: TemplateDescriptor, index: number): TemplateDescriptor {
  const expanded = expandPartialsSafe(descriptor);
  const whole = (expanded.ok ? expanded.data : descriptor) as { global?: Bag; sections?: Bag[] };
  const resolved = resolveTimeRefs(whole).descriptor;
  const { transition: _transition, ...section } = resolved.sections?.[index] ?? {};

  return {
    ...resolved,
    global: { ...resolved.global, transition: { type: 'cut' }, musicEnabled: false },
    sections: [section],
  } as unknown as TemplateDescriptor;
}

function withLook(descriptor: TemplateDescriptor, look: string): TemplateDescriptor {
  const view = descriptor as { global?: Bag; sections?: Bag[] };
  const sections = (view.sections ?? []).map(({ look: _look, ...section }) => section);

  return { ...view, global: { ...view.global, look }, sections } as unknown as TemplateDescriptor;
}

/** The section on screen at `at`, once as authored and once per LOOK preset, in one grid. */
export function runLooks(
  descriptor: TemplateDescriptor,
  options: CompareOptions,
  engine: SnapshotEngine
): Promise<CompareResult> {
  const rendered = asRendered(descriptor, options.format);
  const timeline = timelineOf(rendered);
  const time = snapTime(resolveSnapshotTime(options.at, rendered, timeline), timeline);
  const section = sectionAt(timeline, time);

  if (!section) return Promise.reject(new Error('the template renders no section'));

  const alone = isolateSection(rendered, section.index);
  const variants = [
    { label: 'authored', descriptor: alone },
    ...LOOK_PRESETS.map((look) => ({ label: look, descriptor: withLook(alone, look) })),
  ];

  return runCompare(variants, { ...options, at: time - section.start, cols: options.cols ?? 4 }, engine);
}
