// What a video/project_video segment needs to apply its footage edits: the staged cutaway clips as
// extra inputs, and the section graph rewritten around the edited main clip (footage-graph.ts). Returns
// null for a section without edits, so every other section's command stays byte-identical.

import type { Cutaway, ProjectBuildInfos, ProjectConfig, Section, SectionFootage, SectionOptions } from '@/core/types';
import type Project from '@/core/models/Project';
import type Segment from '@/core/models/Segment';
import DefaultConfig from '@/core/default.config';
import { assertSafeArgToken } from '@/core/arg-guard';
import type AssetManager from '../managers/AssetManager';
import { footageFilterArgs, hasFootageGraph, type FootageAudioFormat, type ResolvedCutaway } from './footage-graph';
import { cutawayMedia } from './cutaway-media';

/** The segment state the lowering reads (a SegmentBuilder's protected fields). */
export interface FootageHost {
  section: Section;
  project: Project;
  segment: Segment;
  assetManager: AssetManager;
  /** Input index of the main clip's video. */
  videoIn: number;
}

export interface FootageAudio {
  /** The main audio pad (`0:a`), or null when the clip has none. */
  input: string | null;
  /** The section's `-af` chain (without apad) for these options, folded into the graph. */
  chain: (options: SectionOptions | undefined) => string;
  /** Pad the clip's own audio to the section length (non-LGPL engines, like the -af apad). */
  pad?: boolean;
}

/** The director's footage plan for the section (absent on a project that never planned one). */
export function footagePlan(host: Pick<FootageHost, 'project' | 'section'>): SectionFootage | undefined {
  const buildInfos = host.project.buildInfos as ProjectBuildInfos | undefined;

  return buildInfos?.footage?.[host.section.name];
}

function countInputs(command: string): number {
  return command.match(/(?:^|\s)-i\s/g)?.length ?? 0;
}

function resolveCutaways(cutaways: Cutaway[], firstInput: number): ResolvedCutaway[] {
  return cutaways.map((cutaway, i) => ({
    input: firstInput + i,
    at: Number(cutaway.at),
    duration: cutaway.duration,
    from: cutaway.from ?? 0,
    audio: cutaway.audio ?? 'a',
    fit: cutaway.fit ?? 'cover',
  }));
}

// How the main clip is framed under a cutaway: `fit` wins (letterbox → contain; cover, blur and off frame
// as cover), else the legacy forceOriginalAspectRatio flag.
function frameFitOf(options: SectionOptions | undefined): 'cover' | 'contain' {
  if (options?.fit !== undefined) return options.fit === 'letterbox' ? 'contain' : 'cover';

  return options?.forceOriginalAspectRatio ? 'contain' : 'cover';
}

function audioFormat(config: ProjectConfig): FootageAudioFormat {
  return {
    sampleRate: config.audioConfig?.sampleRate ?? DefaultConfig.SAMPLE_RATE,
    channelLayout: config.audioConfig?.channelLayout ?? DefaultConfig.CHANNEL_LAYOUT,
  };
}

// The section's rendered length: the probed/edited take capped by the declared duration.
function sectionLength(host: FootageHost): number | undefined {
  const edited = host.project.buildInfos.durations[host.section.name] as number | undefined;
  const declared = host.section.options?.duration ?? 0;

  if (edited === undefined || edited <= 0) return declared > 0 ? declared : undefined;

  return declared > 0 ? Math.min(declared, edited) : edited;
}

/** Section options with the fade-out anchored on the edited take's end (only differs when windows are kept). */
function footageAudioOptions(host: FootageHost): SectionOptions | undefined {
  const length = sectionLength(host);

  if (!footagePlan(host)?.keep || length === undefined) return host.section.options;

  return { ...host.section.options, duration: length };
}

/**
 * The clip-range/ramp/freeze audio prefix (utils/footage-section.ts) with the fade-out timed on the
 * kept-windows length when the section keeps windows (the two edits never combine, see validation).
 */
export function keepAwareRetime(
  options: SectionOptions | undefined,
  retime: { head: string[]; duration?: number }
): { head: string[]; duration?: number } {
  return options?.keep ? { ...retime, duration: options.duration } : retime;
}

/**
 * The input part with the cutaway clips appended, and the `-filter_complex … -map … -map …` args that
 * replace the section's own filters, audio map and `-af`; null for a section without footage edits.
 * `before` is the command ahead of `inputs` (a prepended blank-audio input), counted for numbering.
 */
export function footageArgs(
  host: FootageHost,
  before: string,
  inputs: string,
  audio: FootageAudio
): { inputs: string; filters: string } | null {
  const plan = footagePlan(host);
  const cutaways = host.section.cutaways ?? [];

  if (!hasFootageGraph({ keep: plan?.keep, tonemap: plan?.tonemap, cutaways })) return null;

  const config = host.project.config;
  const sources = cutawayMedia(host.section).map((media) => host.assetManager.fetchCachedMedia(media));
  const filters = footageFilterArgs({
    filtersList: host.segment.filtersList,
    filtersMapList: host.segment.filtersMapList,
    mapsList: host.segment.mapsList,
    videoIn: host.videoIn,
    audioIn: audio.input,
    keep: plan?.keep,
    tonemap: plan?.tonemap,
    cutaways: resolveCutaways(cutaways, countInputs(`${before} ${inputs}`)),
    scale: config.videoConfig?.scale ?? DefaultConfig.SCALE,
    frameFit: frameFitOf(host.section.options),
    audioFormat: audioFormat(config),
    audioChain: audio.chain(footageAudioOptions(host)),
    padAudio: audio.pad ?? false,
    length: sectionLength(host),
  });
  const extra = sources.map((source) => `-i ${assertSafeArgToken(source, 'cutaway source')}`).join(' ');

  return { inputs: `${inputs} ${extra} `, filters };
}
