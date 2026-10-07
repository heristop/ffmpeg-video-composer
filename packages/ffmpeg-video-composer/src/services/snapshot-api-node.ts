// Node entry only: the public snapshot API — frames, comparisons and the timeline/catalog lookups that
// plan them. The render-side modules load lazily, on the first call, and render through the compile()
// the Node entry registers as `snapshotEngine` (src/index.ts).
import { container } from 'tsyringe';
import type { TemplateDescriptor } from '@/core/types';
import type { SnapshotEngine, SnapshotOptions, SnapshotResult } from './snapshot-node';
import type { CompareOptions, CompareResult, CompareVariant } from './snapshot-compare-node';

function engine(): SnapshotEngine {
  return container.resolve<SnapshotEngine>('snapshotEngine');
}

/**
 * Render `descriptor` and grab a PNG at every planned moment (`at`, `atTransitions`, `perSection`; each
 * section's settled moment when none is given), plus contact sheets when `sheet` is set.
 */
export async function renderSnapshots(
  descriptor: TemplateDescriptor,
  options: SnapshotOptions
): Promise<SnapshotResult> {
  const { runSnapshots } = await import('./snapshot-node');

  return runSnapshots(descriptor, options, engine());
}

/** The same moment of several templates, in one labelled grid. */
export async function compareSnapshots(variants: CompareVariant[], options: CompareOptions): Promise<CompareResult> {
  const { runCompare } = await import('./snapshot-compare-node');

  return runCompare(variants, options, engine());
}

/** The section on screen at `options.at`, once as authored and once per LOOK preset, in one grid. */
export async function lookSnapshots(descriptor: TemplateDescriptor, options: CompareOptions): Promise<CompareResult> {
  const { runLooks } = await import('./snapshot-compare-node');

  return runLooks(descriptor, options, engine());
}

export type {
  SnapshotEngine,
  SnapshotFrame,
  SnapshotImage,
  SnapshotOptions,
  SnapshotRenderOptions,
  SnapshotResult,
} from './snapshot-node';
export type { CompareOptions, CompareResult, CompareVariant } from './snapshot-compare-node';
export {
  frameArgs,
  parseSheet,
  safeZoneFilters,
  sheetArgs,
  sheetFilter,
  zoomFilter,
  type SheetInput,
  type SheetLayout,
  type SnapshotZoom,
} from './snapshot-commands';
export {
  resolveSnapshotTime,
  snapshotMoments,
  snapTime,
  SnapshotTimeError,
  type SnapshotMoment,
  type SnapshotPlan,
  type SnapshotTime,
} from '../core/timing/snapshot-times';
export {
  sectionAt,
  videoTimeline,
  type VideoTimeline,
  type VideoTimelineBeat,
  type VideoTimelineCue,
  type VideoTimelineEvent,
  type VideoTimelineSection,
} from '../core/timing/video-timeline';
export {
  CATALOG_KINDS,
  searchMotionCatalog,
  searchTokens,
  type CatalogKind,
  type CatalogMatch,
  type CatalogSearch,
} from '../core/motion/catalog-search';
