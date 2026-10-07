// The shapes the synth renders. The schema (schemas/sound.schemas.ts) validates the same shapes with bounds
// and descriptions; these stay free of zod so the synth is a dependency-free module. Every optional field
// has a default in the synth.

export type Wave = 'sine' | 'triangle' | 'square' | 'saw';
export type Curve = 'linear' | 'exp';
export type NoiseColor = 'white' | 'pink' | 'brown';
export type FilterType = 'lowpass' | 'highpass' | 'bandpass';

/** A swept value over a note: `from` at its start, `to` at its end; exponential by default. */
export interface Sweep {
  from: number;
  to: number;
  curve?: Curve;
  /** Seconds to reach `to`, then held; default the whole note. */
  time?: number;
}

/** Hz, fixed or swept. */
export type Pitch = number | Sweep;

export interface Vibrato {
  /** Hz. */
  rate: number;
  /** Semitones each way. */
  depth: number;
}

/** Attack, hold, decay to `sustain`, sustain until the note's end minus `release`, release to 0. */
export interface Envelope {
  attack?: number;
  hold?: number;
  /** Seconds; default: the rest of the note. */
  decay?: number;
  /** 0..1, default 0 (a percussive note). */
  sustain?: number;
  release?: number;
  /** Shape of the attack (a swell), the decay and the release. Default exp. */
  curve?: Curve;
}

/** A fixed `cutoff` or a sweep `from` → `to` over the note. */
export interface Filter {
  type: FilterType;
  cutoff?: number;
  from?: number;
  to?: number;
  curve?: Curve;
  /** Seconds the sweep takes, then held; default the whole note. */
  time?: number;
  /** Q, 0.5..12. */
  resonance?: number;
}

/** A repeated layer: `repeat` hits `every` seconds, each interval scaled by (1 - accelerate). */
export interface Sequence {
  repeat?: number;
  every?: number;
  accelerate?: number;
  /** 0..1: seeded timing and level variation of the hits. */
  jitter?: number;
}

export interface LayerShape extends Sequence {
  gain?: number;
  /** Seconds before the layer starts. */
  delay?: number;
  /** -1 (left) .. 1 (right). */
  pan?: number;
  envelope?: Envelope;
  /** One filter, or a chain applied in order (e.g. a highpass then a lowpass). */
  filter?: Filter | Filter[];
  /** 0..1: per-layer tanh saturation (square-ish tones, 808s, gritty noise). */
  drive?: number;
  /** Seconds of each note; default from the envelope, else the rest of the sound. */
  length?: number;
}

export interface ToneLayer extends LayerShape {
  source: 'tone';
  wave?: Wave;
  pitch: Pitch;
  vibrato?: Vibrato;
}

export interface NoiseLayer extends LayerShape {
  source: 'noise';
  color?: NoiseColor;
}

export interface StrikePartial {
  /** Frequency as a multiple of the pitch. */
  ratio: number;
  gain: number;
}

export interface StrikeLayer extends LayerShape {
  source: 'strike';
  pitch: Pitch;
  /** Seconds to fall about 60 dB. */
  ring?: number;
  partials?: StrikePartial[];
  /** 0..1: a short noise transient at the hit. */
  click?: number;
}

export interface SilenceLayer {
  source: 'silence';
  length: number;
  delay?: number;
}

export type Layer = ToneLayer | NoiseLayer | StrikeLayer | SilenceLayer;

export interface Echo {
  mix: number;
  /** Seconds between repeats. */
  time?: number;
  feedback?: number;
}

export interface SoundFx {
  saturate?: number;
  crush?: number;
  room?: number;
  echo?: number | Echo;
}

export interface ComposedSound {
  layers: Layer[];
  /** Seconds; default from the layers plus the fx tail. */
  length?: number;
  fx?: SoundFx;
}
