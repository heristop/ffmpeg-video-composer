import type { Section } from 'ffmpeg-video-composer/src/core/types.d.ts';
import type { EditorSection } from './model';
import { choiceFromMarker } from './to-editor-overlay';

export type VideoSectionFields = Pick<
  Extract<EditorSection, { kind: 'video' }>,
  'videoUrl' | 'duration' | 'mute' | 'countdown' | 'countdownSeconds' | 'countdownCustomized'
>;

export function videoSectionOptions(s: Section): VideoSectionFields {
  return {
    ...(s.options?.videoUrl ? { videoUrl: choiceFromMarker(s.options.videoUrl) } : {}),
    duration: s.options?.duration ?? 8,
    mute: Boolean(s.options?.muteSection),
    countdown: Boolean(s.options?.countdown),
    countdownSeconds: s.options?.countdownDuration ?? 4,
    countdownCustomized: true,
  };
}
