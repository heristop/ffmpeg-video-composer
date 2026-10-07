import type AbstractFilesystem from '../platform/filesystem/AbstractFilesystem';
import { hasVirtualFilesystem, type default as AbstractFFmpeg } from '../platform/ffmpeg/AbstractFFmpeg';

// Atomic final output on the native CLI adapters (Node / ffmpeg-static): the assembly, overlay and
// audio passes all write a staging file next to the output, and only a build that completes renames it
// onto `output.mp4`. A failed or cancelled build removes the staging file, so `output.mp4` is either the
// previous complete render or the new one, never a half-written file. The WASM core, the on-device
// engine and the dry-run adapter (no binaries) keep writing `output.mp4` directly.

export interface OutputPaths {
  staging: string;
  final: string;
}

export function resolveOutputPaths(buildDir: string, adapter: AbstractFFmpeg): OutputPaths {
  const final = `${buildDir}/output.mp4`;
  const atomic = Boolean(adapter.binaries) && !hasVirtualFilesystem(adapter);

  return { staging: atomic ? `${buildDir}/output.partial.mp4` : final, final };
}

/** Publishes a completed build's staging file onto the final path; returns the final path. */
export async function publishOutput(
  fs: AbstractFilesystem,
  paths: OutputPaths,
  built: string | null
): Promise<string | null> {
  if (built === null || built !== paths.staging || paths.staging === paths.final) return built;

  await fs.move(paths.staging, paths.final);

  return paths.final;
}

/** Removes a failed or cancelled build's partial file. Never throws. */
export async function discardOutput(fs: AbstractFilesystem, paths: OutputPaths): Promise<void> {
  if (!paths.staging || paths.staging === paths.final) return;

  try {
    if (await fs.stat(paths.staging)) await fs.unlink(paths.staging);
  } catch {
    // Best effort: a missing partial is the expected case.
  }
}
