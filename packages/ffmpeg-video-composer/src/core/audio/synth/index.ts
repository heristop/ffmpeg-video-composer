// The sound synth: composed sounds (schemas/sound.schemas.ts) rendered to PCM and a WAV in pure
// TypeScript, identical on Node, browsers and Hermes. The mix (editor/utils/sfx-sound.ts) writes the WAV
// into the build and places it like a library file.

export * from './bounds';
export type * from './types';
export { renderSound, renderSoundWav, soundUsesSeed, type RenderedSound } from './render';
export { soundLength } from './timing';
export { encodeWav } from './wav';
