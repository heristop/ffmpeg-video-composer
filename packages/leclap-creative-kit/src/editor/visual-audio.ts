// Section audio types for the builder model (re-exported from model.ts), and their recovery from a stored section.
import type { Section } from 'ffmpeg-video-composer/src/core/types.d.ts';
import type { ClipAudioPassthrough } from './motion-passthrough';

// Voice effect applied to the section's own audio (descriptor options.audioEffect): echo (aecho),
// telephone (band-pass), or muffled (low-pass). Hand-modeled rather than schema-inferred (like
// SectionFit in model.ts) since SectionOptionsSchema keeps every option flattened on one object with no
// standalone exported enum to `z.infer` from.
export type AudioEffect = 'echo' | 'telephone' | 'muffled';

// Per-section audio fade: applied to the music track at the start / end of a section.
export interface AudioFadeSide {
  duration: number;
  curve?: string;
}

export interface SectionAudioFade {
  in?: AudioFadeSide;
  out?: AudioFadeSide;
}

// Visual-section audio extras: per-section music-volume override, fade-in/out, and voice effect.
// Co-located with look/grade/motion because they all ride on visual sections only.
export interface VisualAudio extends ClipAudioPassthrough {
  musicVolume?: number;
  audioFade?: SectionAudioFade;
  audioEffect?: AudioEffect;
}

// Recover per-section audio extras (musicVolume / audioFade / audioEffect / voice / audioAutomation).
export function sectionAudioExtrasFrom(s: Section): VisualAudio {
  const mv = s.options?.musicVolume;
  const af = s.options?.audioFade;
  const ae = s.options?.audioEffect;
  const { voice, audioAutomation } = s.options ?? {};

  return {
    ...(mv === undefined ? {} : { musicVolume: mv }),
    ...(af ? { audioFade: af } : {}),
    ...(ae ? { audioEffect: ae } : {}),
    ...(voice ? { voice } : {}),
    ...(audioAutomation ? { audioAutomation } : {}),
  };
}
