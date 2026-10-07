// Prepares the sound effects for the final audio pass (MusicComposer): plans where each lands
// (sfx-plan.ts), resolves each distinct file — a composed sound rendered into the build (sfx-sound.ts),
// else the copy shipped with the creative kit on Node, else a download from the asset source into the
// build assets — and hands back the `-i` arguments plus a
// builder for the mix chains once the caller knows which input index they start at.

import type { ProjectBuildInfos, ProjectConfig, Section, TemplateDescriptor } from '@/core/types';
import { assertSafeArgToken } from '@/core/arg-guard';
import { sfxAssetUrl } from '@/core/asset-source';
import DefaultConfig from '@/core/default.config';
import type AbstractFilesystem from '../../platform/filesystem/AbstractFilesystem';
import type AbstractLogger from '../../platform/logging/AbstractLogger';
import { engineCapabilities } from './filter-compat';
import { VIDEO_SEGMENT_TYPES } from './section-types';
import { hasSfx, planSfx, videoTimeline, type SfxPlacement } from './sfx-plan';
import { sfxFiles, sfxGraph, type SfxGraph } from './sfx-mix';
import { stageSound } from './sfx-sound';

export interface SfxStage {
  placements: SfxPlacement[];
  /** ` -i <file>` per distinct sound, in input order. */
  inputArgs: string;
  /** Length of the joined video, seconds. */
  total: number;
  sampleRate: number;
  graph: (firstInput: number, channelConfig: string) => SfxGraph;
}

export interface SfxStageContext {
  descriptor: TemplateDescriptor;
  buildInfos: ProjectBuildInfos;
  config: ProjectConfig;
  filesystem: AbstractFilesystem;
  logger: AbstractLogger;
}

/** The sections the director renders, in order. */
export function renderingSections(descriptor: TemplateDescriptor): Section[] {
  const sections = Array.isArray(descriptor.sections) ? (descriptor.sections as Section[]) : [];

  return sections.filter((section) => VIDEO_SEGMENT_TYPES.has(section.type));
}

/** Whether the render places any sound effect. */
export function descriptorHasSfx(descriptor: TemplateDescriptor): boolean {
  return hasSfx(renderingSections(descriptor), descriptor.global);
}

async function resolveSfxFile(
  file: string,
  placements: readonly SfxPlacement[],
  ctx: SfxStageContext
): Promise<string> {
  const sound = placements.find((placement) => placement.file === file)?.sound;

  if (sound) return stageSound(file, sound, ctx);

  const bundled = await ctx.filesystem.resolveBundledSfx(file);

  if (bundled) return bundled;

  const url = sfxAssetUrl(file);
  const destination = `${await ctx.filesystem.getBuildPath('assets')}/sfx-${file}`;

  ctx.logger.info(`[Sfx] Fetching ${url}`);
  await ctx.filesystem.move(await ctx.filesystem.fetch(url), destination);

  return destination;
}

/** The planned sound effects with their files resolved, or null when the render places none. */
export async function prepareSfxStage(ctx: SfxStageContext): Promise<SfxStage | null> {
  const segments = renderingSections(ctx.descriptor);
  const placements = planSfx(segments, ctx.buildInfos, ctx.descriptor.global);

  if (placements.length === 0) return null;

  const resolved = await Promise.all(sfxFiles(placements).map((file) => resolveSfxFile(file, placements, ctx)));
  const paths = resolved.map((path) => assertSafeArgToken(path, 'sound effect path'));

  const sampleRate = ctx.config.audioConfig?.sampleRate ?? DefaultConfig.SAMPLE_RATE;
  const deviceFilters = engineCapabilities(ctx.config).deviceFilters;

  ctx.logger.info(`[Sfx] ${placements.length} sound effect(s) from ${paths.length} file(s)`);

  return {
    placements,
    inputArgs: paths.map((path) => ` -i ${path}`).join(''),
    total: videoTimeline(segments, ctx.buildInfos).total,
    sampleRate,
    graph: (firstInput, channelConfig) =>
      sfxGraph({ placements, firstInput, channelConfig, sampleRate, deviceFilters }),
  };
}
