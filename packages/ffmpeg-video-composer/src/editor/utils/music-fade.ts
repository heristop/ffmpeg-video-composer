import type { Section, TemplateDescriptor } from '@/core/types';
import { VIDEO_SEGMENT_TYPES as RENDERABLE_SECTION_TYPES } from './section-types';

// Half the shortest renderable section's RENDERED duration, or +Infinity when there's nothing to
// cap against. The acrossfade eats `fade` seconds off BOTH adjacent legs, so a fade at or beyond
// half a section's rendered length would crossfade that section away entirely. Sections with no/
// zero duration (e.g. `form`) are ignored rather than collapsing the cap to 0.
//
// `durations` is buildInfos.durations (name -> RENDERED length, i.e. min(declared, probed) for a
// project_video whose source clip is shorter than declared — see MusicComposer.
// renderedSectionDuration). Using the declared duration alone would let the cap exceed what the
// rendered timeline actually allows for a trimmed project_video section.
export function maxMusicFadeFromSections(sections: unknown, durations: Record<string, number> = {}): number {
  const list = Array.isArray(sections) ? (sections as Section[]) : [];
  const renderedDurations = list
    .filter((section) => RENDERABLE_SECTION_TYPES.has(section.type))
    .map((section) => {
      const declared = section.options?.duration ?? 0;

      return Math.min(declared, durations[section.name] ?? declared);
    })
    .filter((duration) => duration > 0);

  if (renderedDurations.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.min(...renderedDurations) / 2;
}

/**
 * Resolve the music cross-fade length. `global.audio.musicFade` decouples the music leg-to-leg
 * blend from the video transition — unset, it falls back to `transitionDuration` so existing
 * templates render unchanged. Either way it's capped at half the shortest renderable section's
 * RENDERED duration (maxMusicFadeFromSections) so a short (or trimmed) section can never be
 * entirely consumed by the crossfade, with 0.05s as an absolute floor.
 */
export function resolveMusicFade(
  descriptor: Pick<TemplateDescriptor, 'global'> & { sections?: unknown },
  transitionDuration: number,
  durations: Record<string, number> = {}
): number {
  const requested = descriptor.global?.audio?.musicFade ?? transitionDuration;
  const cap = maxMusicFadeFromSections(descriptor.sections, durations);

  return Math.max(0.05, Math.min(requested, cap));
}

export type MusicFilterOptions = {
  baseFilter: string;
  isFirstSection: boolean;
  isLastSection: boolean;
  transitionDuration: number;
  duration: number;
  musicVolumeLevel: number;
  mapName: string;
};

// Per-section music filter: afade in/out (video-synced fade to/from silence) for the outer
// sections, plain volume for everything in between. Kept alongside the fade-length resolution
// above since both concern the music track's per-section filter chain.
export function buildMusicFilter(opts: MusicFilterOptions): string {
  const { baseFilter, isFirstSection, isLastSection, transitionDuration, duration, musicVolumeLevel, mapName } = opts;

  if (isFirstSection) {
    return `${baseFilter},afade=t=in:st=0:d=${transitionDuration},volume=${musicVolumeLevel}[${mapName}];`;
  }

  if (isLastSection) {
    const st = Math.max(0, duration - transitionDuration);

    return `${baseFilter},afade=t=out:st=${st}:d=${transitionDuration},volume=${musicVolumeLevel}[${mapName}];`;
  }

  return `${baseFilter},volume=${musicVolumeLevel}[${mapName}];`;
}
