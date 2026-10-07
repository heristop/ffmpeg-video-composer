// Where every sound effect lands on the rendered video timeline. Section sfx are in section time, so they
// shift by the section's start in the joined video — the sum of the earlier rendered lengths minus each
// boundary's xfade overlap, the same arithmetic as the assembly (transition-graph.ts) and the QC. Global
// sfx are already video time. A riser (anchor "end") starts its own length earlier; a head that would
// fall before 0 is trimmed. Sorted and capped, so the mix graph is deterministic. Pure.

import type { ProjectBuildInfos, Section, SfxCue, TemplateDescriptorGlobal } from '@/core/types';
import { sfxEntry, type SfxId } from '@/core/audio/sfx-library';
import { seconds } from '@/core/timing/seconds';
import { effectiveDurations } from './transition-graph';

export interface SfxPlacement {
  id: SfxId;
  file: string;
  /** Video time the sound starts playing, seconds. */
  start: number;
  /** Seconds cut from the head of the file (a riser anchored before the video starts). */
  trim: number;
  volume: number;
}

/** At most this many sounds are mixed (the schema bounds each list; this bounds their sum). */
export const MAX_SFX = 48;

function round(value: number): number {
  return Number(value.toFixed(3));
}

/** A section's rendered length: a project_video is trimmed to its declared duration, others render it. */
export function renderedLength(section: Section, durations: Record<string, number>): number {
  const declared = section.options?.duration ?? 0;
  const probed = durations[section.name] ?? 0;

  if (declared > 0 && probed > 0) return Math.min(declared, probed);

  return probed || declared;
}

/** Start of each rendering section in the joined video, and the video length. */
export function videoTimeline(
  segments: readonly Section[],
  buildInfos: Pick<ProjectBuildInfos, 'durations' | 'transitions'>
): { starts: number[]; total: number } {
  const lengths = segments.map((section) => renderedLength(section, buildInfos.durations));
  const xfade = buildInfos.transitions.some((transition) => transition.type !== 'cut');
  const probes = lengths.map((duration) => ({ duration, hasAudio: true }));
  const overlaps = xfade ? effectiveDurations(buildInfos.transitions, probes) : lengths.map(() => 0);
  const starts: number[] = [];
  let cursor = 0;

  for (const [index, length] of lengths.entries()) {
    const start = index === 0 ? 0 : cursor - (overlaps[index - 1] ?? 0);

    starts.push(round(start));
    cursor = start + length;
  }

  return { starts, total: round(cursor) };
}

function place(cue: SfxCue, offset: number): Omit<SfxPlacement, 'trim'> & { at: number } {
  const entry = sfxEntry(cue.id);

  if (!entry) throw new Error(`unknown sound effect "${cue.id}"`);

  const at = offset + (seconds(cue.at) ?? 0);
  const start = entry.anchor === 'end' ? at - entry.duration : at;

  return { id: entry.id, file: entry.file, at, start, volume: cue.volume ?? entry.defaultVolume };
}

/** Every sound effect of the render, in mix order. */
export function planSfx(
  segments: readonly Section[],
  buildInfos: Pick<ProjectBuildInfos, 'durations' | 'transitions'>,
  global: TemplateDescriptorGlobal | undefined
): SfxPlacement[] {
  const { starts, total } = videoTimeline(segments, buildInfos);
  const placed = [
    ...segments.flatMap((section, index) => (section.sfx ?? []).map((cue) => place(cue, starts[index]))),
    ...(global?.sfx ?? []).map((cue) => place(cue, 0)),
  ];

  return placed
    .filter((sound) => sound.at >= 0 && sound.start < total)
    .map(({ id, file, start, volume }) => ({
      id,
      file,
      start: round(Math.max(0, start)),
      trim: round(Math.max(0, -start)),
      volume,
    }))
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
    .slice(0, MAX_SFX);
}

/** Whether the descriptor places any sound effect (the render then needs a final audio pass). */
export function hasSfx(segments: readonly Section[], global: TemplateDescriptorGlobal | undefined): boolean {
  return (global?.sfx?.length ?? 0) > 0 || segments.some((section) => (section.sfx?.length ?? 0) > 0);
}
