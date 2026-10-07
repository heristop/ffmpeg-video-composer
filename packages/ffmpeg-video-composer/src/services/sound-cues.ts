// The sound-effect cues of a template, render-free, for the sound advisories: each list (a section's `sfx`,
// `global.sfx`) with every cue resolved to what it plays (core/audio/sfx-cue.ts: library file or rendered
// sound, its length and anchor), when it starts and ends in the list's own time (null when its `at` is a
// time reference the template can't resolve render-free), and a key naming the sound so repeats are found.

import { cueSeed, resolveCue, type ResolvedCue } from '@/core/audio/sfx-cue';
import { resolveSeed } from '@/core/determinism/contract';
import { resolveTimeRefs } from '@/core/timing/resolve';
import type { SfxCue } from '../schemas/audio.schemas';

type Bag = Record<string, unknown>;

export interface CueSound {
  path: string;
  resolved: ResolvedCue;
  /** Seconds in the list's time, or null when unresolved. */
  start: number | null;
  end: number | null;
}

export interface CueList {
  path: string;
  cues: CueSound[];
  /** The section's declared length, when it has one. */
  duration: number | null;
}

function placed(cue: SfxCue, resolved: ResolvedCue): Pick<CueSound, 'start' | 'end'> {
  if (typeof cue.at !== 'number') return { start: null, end: null };

  const start = resolved.anchor === 'end' ? cue.at - resolved.duration : cue.at;

  return { start, end: start + resolved.duration };
}

function cueSounds(list: unknown, path: string, seedPath: string, root: number): CueSound[] {
  if (!Array.isArray(list)) return [];

  return (list as SfxCue[]).flatMap((cue, k) => {
    const resolved = resolveCue(cue, cueSeed(root, `${seedPath}[${k}]`));

    return resolved ? [{ path: `${path}[${k}]`, resolved, ...placed(cue, resolved) }] : [];
  });
}

function declaredDuration(section: Bag): number | null {
  const duration = (section.options as Bag | undefined)?.duration;

  return typeof duration === 'number' ? duration : null;
}

function resolvedTemplate(template: Bag): Bag {
  try {
    return resolveTimeRefs(template).descriptor;
  } catch {
    return template;
  }
}

/** Every sfx list of `descriptor` with its cues resolved. */
export function cueLists(descriptor: unknown): CueList[] {
  const template = resolvedTemplate((descriptor ?? {}) as Bag);
  const global = (template.global ?? {}) as Bag;
  const root = resolveSeed({ global });
  const sections = Array.isArray(template.sections) ? (template.sections as Bag[]) : [];
  const lists = sections.map((section, i) => ({
    path: `sections[${i}].sfx`,
    cues: cueSounds(section.sfx, `sections[${i}].sfx`, `sections.${String(section.name)}.sfx`, root),
    duration: declaredDuration(section),
  }));

  return [
    ...lists,
    { path: 'global.sfx', cues: cueSounds(global.sfx, 'global.sfx', 'global.sfx', root), duration: null },
  ];
}

/** Whether the template plays a music bed under the sounds. */
export function hasMusic(descriptor: unknown): boolean {
  const global = ((descriptor ?? {}) as Bag).global as Bag | undefined;

  return global?.musicEnabled === true;
}
