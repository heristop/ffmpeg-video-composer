// The footage plan of each video/project_video section, resolved once the clips are probed and before
// any segment renders: the source windows kept (explicit `options.keep`, or `trimSilence` analysed with
// silencedetect on Node), whether an HDR source is tone-mapped, and the section's resulting length — so
// buildInfos.durations, the QC expectations and the music windows all see the edited take.

import type { FFMpegInfos, KeepRange, ProjectBuildInfos, Section, SectionFootage } from '@/core/types';
import { TONEMAP_FILTERS, type FootageAnalyzer } from '@/core/footage/analyzer';
import { clipKeepRanges, computeKeepRanges, keptDuration, resolveTrimSilence } from '@/core/footage/keep-ranges';
import { footageSource, probeFootage, type FootageSourceDeps } from './footage-source';

export interface FootagePlanDeps extends FootageSourceDeps {
  analyzer: FootageAnalyzer | null;
}

/** Advisory code logged when an HDR clip renders on the SDR pipeline without a tone-map. */
export const HDR_ADVISORY = 'hdr_source_sdr_pipeline';

/** Options that change a section's length: explicit keep windows or silence trimming. */
export function editsFootageLength(section: Section): boolean {
  return section.options?.keep !== undefined || section.options?.trimSilence !== undefined;
}

/** Record what the length probe of a project_video learnt about its clip (traits, audio). */
export function recordProbe(buildInfos: ProjectBuildInfos, name: string, infos: FFMpegInfos): void {
  buildInfos.footage ??= {};
  buildInfos.footage[name] = { ...buildInfos.footage[name], traits: infos.traits, hasAudio: infos.audioCodec !== null };
}

async function tonemapFor(deps: FootagePlanDeps, section: Section, plan: SectionFootage): Promise<boolean> {
  const hdr = plan.traits?.hdr;

  if (!hdr) return false;

  if (deps.analyzer && (await deps.analyzer.hasFilters(TONEMAP_FILTERS))) {
    deps.logger.info(`[Footage] ${section.name}: ${hdr} HDR source tone-mapped to SDR (zscale + tonemap)`);

    return true;
  }

  deps.logger.warn(
    `[${HDR_ADVISORY}] ${section.name}: ${hdr} HDR source on the SDR pipeline without a tone-map (this FFmpeg ` +
      'build has no zscale/tonemap); colours will look washed out. Export or capture the clip in SDR.'
  );

  return false;
}

async function trimmedRanges(
  deps: FootagePlanDeps,
  section: Section,
  source: string | null,
  sourceDuration: number | null
): Promise<KeepRange[] | undefined> {
  const option = section.options?.trimSilence;

  if (!option) return undefined;

  if (!deps.analyzer || !source || !sourceDuration || source === '') {
    deps.logger.warn(
      `[Footage] ${section.name}: trimSilence needs the Node analysis (silencedetect) and a probed clip; ` +
        'rendering the take untrimmed. Pass precomputed windows as options.keep on this host.'
    );

    return undefined;
  }

  const params = resolveTrimSilence(option);

  return computeKeepRanges(await deps.analyzer.silences(source, params), sourceDuration, params);
}

// Length of the edited take: a project_video is its kept length (the QC caps it by the declared
// duration), a video section renders `-t duration`, so the declared length still caps the kept one.
function editedLength(section: Section, keep: KeepRange[]): number {
  const kept = keptDuration(keep);
  const declared = section.options?.duration ?? 0;

  return section.type === 'video' && declared > 0 ? Math.min(declared, kept) : kept;
}

interface SectionProbe {
  source: string | null;
  duration: number | null;
}

// project_video clips were probed for their length already; a video section is probed here only when
// its length edit needs the clip (silence analysis or clipping explicit windows).
async function probeSection(deps: FootagePlanDeps, section: Section, probed: number): Promise<SectionProbe> {
  const needsSource = section.options?.trimSilence !== undefined;

  if (section.type === 'project_video') {
    return { source: needsSource ? await footageSource(deps, section) : null, duration: probed || null };
  }

  if (!needsSource) return { source: null, duration: null };

  const source = await footageSource(deps, section);
  const infos = source ? await probeFootage(deps, source) : null;

  return { source, duration: infos?.duration ?? null };
}

async function planSection(deps: FootagePlanDeps, section: Section, probed: number): Promise<SectionFootage> {
  const plan: SectionFootage = {};
  const explicit = section.options?.keep;

  if (explicit || section.options?.trimSilence) {
    const { source, duration } = await probeSection(deps, section, probed);
    const keep = explicit ? clipKeepRanges(explicit, duration) : await trimmedRanges(deps, section, source, duration);

    if (keep) plan.keep = keep;
  }

  return plan;
}

/**
 * Resolves every rendering video/project_video section's footage plan into `buildInfos.footage` and
 * rewrites its entry in `durations` (same order as `sections`) when the edit changes its length.
 */
export async function planFootage(
  deps: FootagePlanDeps,
  sections: readonly Section[],
  durations: number[],
  buildInfos: ProjectBuildInfos
): Promise<void> {
  const footage = (buildInfos.footage ??= {});

  async function resolve(section: Section, index: number): Promise<SectionFootage | null> {
    if (section.type !== 'video' && section.type !== 'project_video') return null;

    const plan: SectionFootage = { ...footage[section.name], ...(await planSection(deps, section, durations[index])) };
    plan.tonemap = await tonemapFor(deps, section, plan);

    if (plan.traits?.vfr) deps.logger.info(`[Footage] ${section.name}: variable-frame-rate source, conformed to CFR`);

    return plan;
  }

  const plans = await Promise.all(sections.map(resolve));

  for (const [index, plan] of plans.entries()) {
    if (!plan) continue;

    if (plan.keep) durations[index] = editedLength(sections[index], plan.keep);

    footage[sections[index].name] = plan;
  }
}

/**
 * Runs the take plans after the clip/ramp/freeze lengths are recorded: each section's current length is
 * its source length (take edits never combine with clip/ramp/freeze), and a kept-windows length replaces
 * it in buildInfos.durations and totalLength.
 */
export async function applyTakePlans(
  deps: FootagePlanDeps,
  sections: readonly Section[],
  buildInfos: ProjectBuildInfos
): Promise<void> {
  const durations = sections.map((section) => buildInfos.durations[section.name] ?? 0);
  const before = durations.reduce((sum, value) => sum + value, 0);

  await planFootage(deps, sections, durations, buildInfos);

  for (const [index, section] of sections.entries()) buildInfos.durations[section.name] = durations[index];

  buildInfos.totalLength += durations.reduce((sum, value) => sum + value, 0) - before;
}
