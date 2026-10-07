// Stages the bundled emoji images a section composites into its build directory, cheapest source
// first — the same ladder as the bundled fonts:
//   1. already staged (an earlier section of this render);
//   2. shipped with the package / the creative kit (Node: resolveBundledEmoji);
//   3. a host-staged copy under the assets dir, `/assets/emoji/<file>` (the web app's public dir, the
//      Expo app's staged assets — see scripts/copy-core-assets.ts);
//   4. the public asset library (a published Node install ships no images).
import { catalogAssetUrl } from '@/core/asset-source';
import { EMOJI_DIR } from '@/core/emoji-assets';
import type AbstractFilesystem from '../../platform/filesystem/AbstractFilesystem';
import type AbstractLogger from '../../platform/logging/AbstractLogger';

export interface StagingDeps {
  filesystem: AbstractFilesystem;
  logger: AbstractLogger;
  section: string;
}

async function stageLocally(file: string, target: string, deps: StagingDeps): Promise<boolean> {
  const { filesystem } = deps;

  if (await filesystem.stat(target)) return true;

  const bundled = await filesystem.resolveBundledEmoji(file);

  if (bundled) {
    await filesystem.copy(bundled, target);

    return true;
  }

  const local = await filesystem.resolveLocalAsset(`/assets/${EMOJI_DIR}/${file}`);

  if (local) {
    await filesystem.copy(local, target);

    return true;
  }

  return false;
}

async function stageRemotely(file: string, target: string, deps: StagingDeps): Promise<void> {
  try {
    const downloaded = await deps.filesystem.fetch(catalogAssetUrl(`${EMOJI_DIR}/${file}`));

    await deps.filesystem.move(downloaded, target);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    throw new Error(
      `[${deps.section}][Emoji] cannot stage ${file}: not bundled, not staged under /assets/${EMOJI_DIR}/ ` +
        `and the download failed (${reason}). Stage the emoji images with the app, or set global.emoji to "strip".`,
      { cause: error }
    );
  }
}

async function stageOne(file: string, dir: string, deps: StagingDeps): Promise<void> {
  const target = `${dir}/${file}`;

  if (!(await stageLocally(file, target, deps))) await stageRemotely(file, target, deps);

  deps.logger.info(`[${deps.section}][Emoji] staged ${file}`);
}

/** Stages `files` (bare image names) into `dir`. */
export async function stageEmojiImages(files: string[], dir: string, deps: StagingDeps): Promise<void> {
  await Promise.all(files.map((file) => stageOne(file, dir, deps)));
}
