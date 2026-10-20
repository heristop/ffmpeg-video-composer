// Pure math behind the program monitor's sound and its edit points: which track plays under the
// timeline, at what level at a given second, where the scene edges sit, and how a scrub snaps to them.
import { findMusic, MUSIC_LIBRARY, type MediaCredit } from '@/data/mediaCatalog';
import type { AudioMix, EditorSection, SectionAudioFade, VisualAudio } from '../templateEditorModel';
import { sceneClockAt, type Segment } from './program-timeline.logic';

// The engine renders at 30 fps unless the template says otherwise (global.fps); the editor model does
// not carry fps, so the transport counts frames at the engine default.
export const PREVIEW_FPS = 30;

// The track the render lays under the video: the music scene's default (first ticked) track, or the
// library stand-in drafts borrow. Null when the template has no music scene, so playback stays silent.
export function programMusicTrack(sections: EditorSection[]): MediaCredit | null {
  const music = sections.find((section) => section.kind === 'music');

  if (music?.kind !== 'music') return null;

  return findMusic(music.allowed.at(0) ?? '') ?? MUSIC_LIBRARY.at(0) ?? null;
}

// A visual scene's audio extras; the other kinds carry none.
function sectionAudio(section: EditorSection | undefined): VisualAudio {
  if (section?.kind === 'video' || section?.kind === 'color' || section?.kind === 'image') return section;

  return {};
}

// 0..1 multiplier for a section's own fade-in / fade-out at `localT` seconds into it.
function fadeFactor(fade: SectionAudioFade | undefined, localT: number, duration: number): number {
  const fadeIn = fade?.in?.duration ?? 0;
  const fadeOut = fade?.out?.duration ?? 0;
  const rising = fadeIn > 0 ? Math.min(1, localT / fadeIn) : 1;
  const falling = fadeOut > 0 ? Math.min(1, (duration - localT) / fadeOut) : 1;

  return Math.max(0, Math.min(rising, falling));
}

// The music level at master time `t`: the scene's own music volume (else the template's), shaped by
// that scene's fades. The render also cross-fades level changes between scenes (global.audio.musicFade);
// the preview steps them, which is close enough to judge a mix.
export function musicGainAt(timeline: Segment[], sections: EditorSection[], mix: AudioMix, t: number): number {
  const at = sceneClockAt(timeline, t);

  if (!at) return 0;

  const audio = sectionAudio(sections[at.index]);
  const level = audio.musicVolume ?? mix.musicVolume;

  return Math.max(0, Math.min(1, level * fadeFactor(audio.audioFade, at.localT, at.segment.duration)));
}

// Where in the track master time `t` falls: the engine loops music under longer videos.
export function musicTimeAt(t: number, trackDuration: number): number {
  if (!Number.isFinite(trackDuration) || trackDuration <= 0) return Math.max(0, t);

  return Math.max(0, t) % trackDuration;
}

// Every edit point on the timeline: each scene's start, plus the end of the last one.
export function sceneEdges(timeline: Segment[]): number[] {
  if (timeline.length === 0) return [];

  return [...timeline.map((segment) => segment.start), timeline.at(-1)?.end ?? 0];
}

// The next (direction 1) or previous (-1) edit point from `t`, or `t` itself at either end.
export function adjacentEdge(edges: number[], t: number, direction: 1 | -1): number {
  const epsilon = 1e-3;

  if (direction === 1) return edges.find((edge) => edge > t + epsilon) ?? t;

  return edges.toReversed().find((edge) => edge < t - epsilon) ?? t;
}

// A scrub lands on a scene edge when it comes within `threshold` seconds of one.
export function snapToEdge(edges: number[], t: number, threshold: number): number {
  const nearest = edges.reduce<number | null>((best, edge) => {
    if (Math.abs(edge - t) > threshold) return best;

    if (best === null || Math.abs(edge - t) < Math.abs(best - t)) return edge;

    return best;
  }, null);

  return nearest ?? t;
}

// The time one frame step (or `frames` of them) away, clamped to the timeline.
export function stepFrames(t: number, frames: number, total: number, fps = PREVIEW_FPS): number {
  const frame = Math.round(t * fps) + frames;

  return Math.min(total, Math.max(0, frame / fps));
}
