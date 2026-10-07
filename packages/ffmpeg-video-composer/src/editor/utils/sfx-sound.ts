// Stages a composed sound for the mix: renders it with the synth (core/audio/synth) to
// `<build>/sfx/<hash>.wav` through the platform filesystem — Node writes the file, the browser adapter
// stores it in IndexedDB (the WASM adapter mirrors every input into MEMFS before a command), Expo writes it
// as base64 — and returns the path, which the mix then uses like a library file. A file already in the
// build is reused: its name is the content hash (and seed), so it is the same sound.

import type { ComposedPlacement } from '@/core/audio/sfx-cue';
import { renderSoundWav } from '@/core/audio/synth/render';
import type AbstractFilesystem from '../../platform/filesystem/AbstractFilesystem';
import type AbstractLogger from '../../platform/logging/AbstractLogger';

export interface SoundStageContext {
  filesystem: AbstractFilesystem;
  logger: AbstractLogger;
}

/** The build path of `file`, rendered from `sound` unless it is already there. */
export async function stageSound(file: string, sound: ComposedPlacement, ctx: SoundStageContext): Promise<string> {
  const path = `${await ctx.filesystem.getBuildPath('sfx')}/${file}`;

  if (await ctx.filesystem.stat(path)) {
    ctx.logger.info(`[Sfx] cached ${file}`);

    return path;
  }

  await ctx.filesystem.writeFile(path, renderSoundWav(sound.spec, sound.seed));
  ctx.logger.info(`[Sfx] synthesized ${file}`);

  return path;
}
