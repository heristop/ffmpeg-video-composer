// A section's footage plan as the segment builders see it: the probed source length (recorded by the
// director before segments build) feeds core/footage/plan.ts, which every lowering reads from.

import type { Filter, ProjectBuildInfos, ProjectConfig, Section } from '@/core/types';
import DefaultConfig from '@/core/default.config';
import { footagePlan, hasFootageEdits, type FootagePlan } from '@/core/footage/plan';
import { footageAudioChain, footageVideoFilters } from './footage-lowering';

const FOOTAGE_TYPES = new Set(['video', 'project_video']);

/** The full source length of the clip a section plays, when it was probed. */
export function sourceLengthOf(section: Section, buildInfos: ProjectBuildInfos): number | undefined {
  const lengths = buildInfos.sourceDurations ?? {};

  if (section.type === 'project_video') return lengths[section.name];

  const reused = section.options?.useVideoSection;

  return section.type === 'video' && reused ? lengths[reused] : undefined;
}

/** The section's footage plan, or null when it edits nothing (the section then lowers as before). */
export function sectionFootagePlan(section: Section, buildInfos: ProjectBuildInfos, fps: number): FootagePlan | null {
  if (!FOOTAGE_TYPES.has(section.type) || !hasFootageEdits(section.options)) return null;

  const plan = footagePlan(section.options ?? {}, sourceLengthOf(section, buildInfos), fps);

  if (!plan) throw new Error(`section "${section.name}": a footage time reference was not resolved before lowering`);

  return plan;
}

/** The section's footage video head (clip range / ramp / freeze filters), or none when it edits nothing. */
export function sectionFootageHead(section: Section, buildInfos: ProjectBuildInfos, fps: number): Filter[] {
  const plan = sectionFootagePlan(section, buildInfos, fps);

  return plan ? footageVideoFilters(plan, fps) : [];
}

/** The `-t` an edited video section renders for: its declared duration, capped at the edited length. */
export function editedDuration(declared: number | undefined, plan: FootagePlan | null): number | undefined {
  if (plan?.length === undefined) return declared;

  return declared === undefined || declared <= 0 ? plan.length : Math.min(declared, plan.length);
}

/** What the segment builders need to lower a section's footage audio. */
export interface FootageAudioContext {
  config: ProjectConfig;
  buildInfos: ProjectBuildInfos;
  /** False when the mapped audio is not the clip's own sound (muted, blank or synthesized). */
  clipSound: boolean;
}

/**
 * The footage `-af` prefix plus the section length the audio fades time against: unchanged (no prefix,
 * declared duration) for an unedited section or one whose mapped audio is not the clip's own sound.
 */
export function footageAudio(section: Section, ctx: FootageAudioContext): { head: string[]; duration?: number } {
  const fps = ctx.config.videoConfig?.fps ?? DefaultConfig.FPS;
  const plan = sectionFootagePlan(section, ctx.buildInfos, fps);
  const duration = editedDuration(section.options?.duration, plan);

  if (!plan || !ctx.clipSound) return { head: [], duration };

  const format = {
    sampleRate: ctx.config.audioConfig?.sampleRate ?? DefaultConfig.SAMPLE_RATE,
    channelLayout: ctx.config.audioConfig?.channelLayout ?? DefaultConfig.CHANNEL_LAYOUT,
  };

  return { head: footageAudioChain(plan, fps, format, section.options ?? {}), duration };
}
