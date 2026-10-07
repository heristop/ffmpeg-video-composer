// Where every sound effect lands on the rendered video timeline. Section sfx are in section time, so they
// shift by the section's start in the joined video — the sum of the earlier rendered lengths minus each
// boundary's xfade overlap, the same arithmetic as the assembly (transition-graph.ts) and the QC. Global
// sfx are already video time. A riser (anchor "end") starts its own length earlier; a head that would
// fall before 0 is trimmed. Sorted and capped, so the mix graph is deterministic. A composed `sound`
// (core/audio/sfx-cue.ts) carries its spec and seed — global.seed hashed with the cue's path, like fx —
// so the stage can render it to the file named here. Pure.

import type { ProjectBuildInfos, Section, SfxCue, TemplateDescriptorGlobal } from '@/core/types';
import { cueSeed, resolveCue, type ComposedPlacement } from '@/core/audio/sfx-cue';
import { resolveSeed } from '@/core/determinism/contract';
import { seconds } from '@/core/timing/seconds';
import { effectiveDurations } from './transition-graph';

export interface SfxPlacement {
  /** The library id, or `sound-<hash>` for a composed sound. */
  id: string;
  /** A library file name, or `<hash>.wav` rendered into the build for a composed sound. */
  file: string;
  /** Video time the sound starts playing, seconds. */
  start: number;
  /** Seconds cut from the head of the file (a riser anchored before the video starts). */
  trim: number;
  volume: number;
  /** Set for a composed sound: what to render into `file`. */
  sound?: ComposedPlacement;
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

type Placed = Omit<SfxPlacement, 'trim'> & { at: number };

function place(cue: SfxCue, offset: number, seed: number): Placed {
  const entry = resolveCue(cue, seed);

  if (!entry) throw new Error(`unknown sound effect "${cue.id ?? cue.sound?.preset}"`);

  const at = offset + (seconds(cue.at) ?? 0);
  const start = entry.anchor === 'end' ? at - entry.duration : at;
  const placed: Placed = { id: entry.id, file: entry.file, at, start, volume: cue.volume ?? entry.defaultVolume };

  return entry.sound ? { ...placed, sound: entry.sound } : placed;
}

/** Every sound effect of the render, in mix order. */
export function planSfx(
  segments: readonly Section[],
  buildInfos: Pick<ProjectBuildInfos, 'durations' | 'transitions'>,
  global: TemplateDescriptorGlobal | undefined
): SfxPlacement[] {
  const { starts, total } = videoTimeline(segments, buildInfos);
  const root = resolveSeed({ global });
  const placed = [
    ...segments.flatMap((section, index) =>
      (section.sfx ?? []).map((cue, k) =>
        place(cue, starts[index], cueSeed(root, `sections.${section.name}.sfx[${k}]`))
      )
    ),
    ...(global?.sfx ?? []).map((cue, k) => place(cue, 0, cueSeed(root, `global.sfx[${k}]`))),
  ];

  return placed
    .filter((sound) => sound.at >= 0 && sound.start < total)
    .map(({ id, file, start, volume, sound }) => ({
      id,
      file,
      start: round(Math.max(0, start)),
      trim: round(Math.max(0, -start)),
      volume,
      ...(sound ? { sound } : {}),
    }))
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
    .slice(0, MAX_SFX);
}

/** Whether the descriptor places any sound effect (the render then needs a final audio pass). */
export function hasSfx(segments: readonly Section[], global: TemplateDescriptorGlobal | undefined): boolean {
  return (global?.sfx?.length ?? 0) > 0 || segments.some((section) => (section.sfx?.length ?? 0) > 0);
}
