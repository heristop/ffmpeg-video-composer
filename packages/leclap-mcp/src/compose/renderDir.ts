import fs from 'node:fs/promises';
import path from 'node:path';

// Housekeeping of one compose_video render directory: naming the deliverable and pruning the engine's
// intermediates. Every helper swallows its errors — cleanup must never turn a good render into a failure.

export async function removeDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}

// Delete everything in the render dir except the kept deliverables. Recurses so intermediate
// subdirs are removed too. Swallows errors — cleanup must never turn a successful render into one.
export async function pruneRenderDir(dir: string, keep: string[]): Promise<void> {
  const kept = new Set(keep);

  try {
    const entries = await fs.readdir(dir);
    await Promise.all(
      entries
        .filter((entry) => !kept.has(entry))
        .map((entry) => fs.rm(path.join(dir, entry), { recursive: true, force: true }).catch(() => {}))
    );
  } catch {
    // Directory unreadable — nothing to prune.
  }
}

// Honour the optional outputBaseName by copying the fixed engine output (build/output.mp4) to a
// sibling `<outputBaseName>.mp4`, so the caller gets the name it asked for (per-render naming is an
// app concern, not the engine's). The regex on the input schema already rejects path separators.
// A copy failure must NOT sink a render that already succeeded — fall back to the real output path
// so the caller still gets a usable clip instead of a spurious tool error.
export async function applyOutputName(outputPath: string, outputBaseName: string | undefined): Promise<string> {
  if (!outputBaseName) {
    return outputPath;
  }

  const named = path.join(path.dirname(outputPath), `${outputBaseName}.mp4`);

  if (named === outputPath) {
    return outputPath;
  }

  try {
    await fs.copyFile(outputPath, named);

    return named;
  } catch {
    return outputPath;
  }
}
