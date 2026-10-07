// Section audio types for the builder model (re-exported from model.ts).
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
