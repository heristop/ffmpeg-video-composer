// The sound synth: composed sounds (schemas/sound.schemas.ts) rendered to PCM and a WAV in pure
// TypeScript: deterministic on each platform, and the same on Node, browsers and Hermes up to the last bit
// (each engine computes Math.sin and Math.exp its own way). The mix (editor/utils/sfx-sound.ts) writes the WAV
// into the build and places it like a library file.

export * from './bounds';
export type * from './types';
export { renderSound, renderSoundWav, soundUsesSeed, type RenderedSound } from './render';
export { soundLength } from './timing';
export { encodeWav } from './wav';
