// The synth's fixed rate and the ceilings every parameter is held to. The schema (schemas/sound.schemas.ts)
// reads the same numbers, so a value the schema accepts is one the synth renders within bounds. Pure data.

/** Every sound renders at this rate, stereo, like the library files. */
export const SYNTH_RATE = 48000;

/** Longest sound, seconds (also the cap of a derived length). */
export const MAX_SOUND_LENGTH = 4;
/** Shortest derived length, seconds. */
export const MIN_SOUND_LENGTH = 0.02;
export const MAX_LAYERS = 8;
export const MIN_PITCH = 20;
export const MAX_PITCH = 12000;
export const MIN_CUTOFF = 20;
export const MAX_CUTOFF = 20000;
/** Filter Q range: 0.5 (gentle) to 12 (ringing, still bounded). */
export const MIN_RESONANCE = 0.5;
export const MAX_RESONANCE = 12;
export const MAX_REPEAT = 32;
export const MAX_PARTIALS = 8;

/** The library sounds are peak-normalised to this level; synthesized ones too. */
export const PEAK_DBFS = -3;

/** Defaults a layer falls back to. */
export const DEFAULT_ATTACK = 0.005;
export const DEFAULT_RING = 0.6;
/** Note length of a layer that only says "fill the sound", when the sound has no length either. */
export const DEFAULT_NOTE = 0.5;
export const DEFAULT_RESONANCE = Math.SQRT1_2;

/** Mix level of a composed sound when its cue sets no `volume` (the library defaults sit at 0.45..0.7). */
export const DEFAULT_SOUND_VOLUME = 0.6;

/** Bumped when a change to the synth changes rendered bytes, so cached files are not reused. */
export const SYNTH_VERSION = 2;
