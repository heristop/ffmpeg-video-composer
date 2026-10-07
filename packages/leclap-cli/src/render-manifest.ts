import { realpathSync, writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { RenderManifest } from 'ffmpeg-video-composer';

// `leclap render --manifest`: the render manifest (template, graph, asset and output digests) is written
// next to the video, so `leclap verify` can later prove the file is still that render.

export function manifestPathFor(video: string): string {
  return `${video}.manifest.json`;
}

export function writeManifest(video: string, manifest: RenderManifest): string {
  const target = manifestPathFor(video);
  writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);

  return target;
}

/**
 * Refuses an `--output` that is one of the render's inputs (the template, a `--video` clip): copying the
 * result there would destroy the source. Compared after resolving symlinks.
 */
export function assertOutputIsNotInput(outputAbs: string | undefined, inputs: readonly string[]): void {
  if (!outputAbs) return;

  const target = canonical(outputAbs);
  const clash = inputs.find((input) => canonical(input) === target);

  if (clash) throw new Error(`--output ${outputAbs} is also an input of this render (${clash}); choose another path`);
}

function canonical(file: string): string {
  try {
    return realpathSync(file);
  } catch {
    return path.resolve(file);
  }
}

// Copy the engine's `build/output.mp4` to the user's `--output` path (engine output naming is fixed;
// per-render placement is the CLI's concern). The copy goes to a temp name in the target's directory and
// is renamed into place, so `--output` is never left half-written; a failed copy removes the temp file.
// Returns the path the summary should report.
export async function finalizeOutput(result: string, outputAbs: string | undefined): Promise<string> {
  if (!outputAbs || canonical(outputAbs) === canonical(result)) return outputAbs ?? result;

  await fs.mkdir(path.dirname(outputAbs), { recursive: true });
  const partial = path.join(path.dirname(outputAbs), `.${path.basename(outputAbs)}.${process.pid}.partial`);

  try {
    await fs.copyFile(result, partial);
    await fs.rename(partial, outputAbs);
  } catch (error) {
    await fs.rm(partial, { force: true });

    throw error;
  }

  return outputAbs;
}
