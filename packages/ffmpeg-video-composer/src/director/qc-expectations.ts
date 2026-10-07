import type { ProjectBuildInfos, Section, TemplateDescriptorGlobal } from '@/core/types';
import type { QcExpectations } from '@/core/qc/types';
import { effectiveDurations } from '../editor/utils/transition-graph';
import { VIDEO_SEGMENT_TYPES } from '../editor/utils/section-types';
import { loudnessTarget } from '../editor/utils/music-mix';
// A section's rendered length: a project_video is trimmed to its declared duration (`-t … -shortest`).
import { hasSfx, renderedLength } from '../editor/utils/sfx-plan';

// What the output QC (core/qc) expects of this render, read from the plan once the section lengths are
// known and before the build state resets at the end of the compile. Pure.

// Clip sound reaches the output when a project_video clip has its own audio and is not muted, or a
// video section is explicitly unmuted.
function hasClipSound(section: Section, sourceHasAudio: Record<string, boolean>): boolean {
  if (section.options?.muteSection === true) return false;

  if (section.type === 'project_video') return Boolean(sourceHasAudio[section.name] as boolean | undefined);

  return section.type === 'video' && section.options?.muteSection === false;
}

export function qcExpectations(
  segments: readonly Section[],
  buildInfos: ProjectBuildInfos,
  global: TemplateDescriptorGlobal | undefined,
  fps: number
): QcExpectations {
  const rendering = segments.filter((section) => VIDEO_SEGMENT_TYPES.has(section.type));
  const probes = rendering.map((section) => ({
    duration: renderedLength(section, buildInfos.durations),
    hasAudio: true,
  }));
  const total = probes.reduce((sum, probe) => sum + probe.duration, 0);
  const hasTransition = buildInfos.transitions.some((transition) => transition.type !== 'cut');
  // The xfade assembly overlaps each boundary by its capped duration (a cut becomes a 1 ms fade there);
  // the plain concat path overlaps nothing.
  const overlap = hasTransition ? effectiveDurations(buildInfos.transitions, probes).reduce((a, b) => a + b, 0) : 0;
  const music = Boolean(global?.musicEnabled) && Boolean(buildInfos.musicPath);

  return {
    durationSeconds: total - overlap,
    fps,
    audioExpected:
      music ||
      hasSfx(rendering, global) ||
      rendering.some((section) => hasClipSound(section, buildInfos.sourceHasAudio)),
    normalize: global?.audio?.normalize ?? null,
    loudnessTarget: loudnessTarget(global),
  };
}
