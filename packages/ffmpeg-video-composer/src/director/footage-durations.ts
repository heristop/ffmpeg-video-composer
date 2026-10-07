// Section lengths once the clips are probed, with footage edits (clip range, speed ramp, freeze) applied:
// what buildInfos.durations holds for the timeline, transitions, music windows, progress and the output
// QC. Unedited sections keep the historical values (probed length for project_video, declared otherwise).

import type { ProjectBuildInfos, Section } from '@/core/types';
import { footagePlan, hasFootageEdits } from '@/core/footage/plan';
import { editedDuration, sourceLengthOf } from '../editor/utils/footage-section';

// A clip whose in-point is past its end has nothing to play: fail before rendering, with the numbers.
function assertClipInRange(section: Section, sourceLength: number | undefined): void {
  const from = section.options?.clip?.from ?? 0;

  if (sourceLength !== undefined && from >= sourceLength) {
    throw new Error(
      `section "${section.name}": options.clip.from (${from}s) is not before the end of its clip (${sourceLength}s)`
    );
  }
}

/** The section's rendered-timeline length given what was probed (buildInfos.sourceDurations). */
export function sectionLength(section: Section, buildInfos: ProjectBuildInfos, fps: number): number {
  const probed = section.type === 'project_video' ? buildInfos.sourceDurations?.[section.name] : undefined;
  const unedited = section.type === 'project_video' ? probed : section.options?.duration;

  if (!hasFootageEdits(section.options)) return unedited ?? 0;

  return editedLength(section, buildInfos, fps) ?? unedited ?? 0;
}

// A project_video lasts its edited length; a video section its declared duration capped at it.
function editedLength(section: Section, buildInfos: ProjectBuildInfos, fps: number): number | undefined {
  const source = sourceLengthOf(section, buildInfos);
  assertClipInRange(section, source);
  const plan = footagePlan(section.options ?? {}, source, fps);

  return section.type === 'project_video' ? plan?.length : editedDuration(section.options?.duration, plan);
}

/** Why an out-point was clamped, for the build log (null when it fits the probed clip). */
export function clipClampNote(section: Section, buildInfos: ProjectBuildInfos): string | null {
  const to = section.options?.clip?.to;
  const source = sourceLengthOf(section, buildInfos);

  if (to === undefined || source === undefined || to <= source) return null;

  return `[${section.name}] options.clip.to (${to}s) is past the end of the clip (${source}s); clamped`;
}

/** Every section's length into buildInfos.durations / totalLength, logging clamped out-points. */
export function recordSectionLengths(
  segments: readonly Section[],
  buildInfos: ProjectBuildInfos,
  fps: number,
  warn: (note: string) => void
): void {
  for (const segment of segments) {
    const duration = sectionLength(segment, buildInfos, fps);
    const clamp = clipClampNote(segment, buildInfos);

    if (clamp) warn(clamp);

    buildInfos.totalLength += duration;
    buildInfos.durations[segment.name] = duration;
  }
}
