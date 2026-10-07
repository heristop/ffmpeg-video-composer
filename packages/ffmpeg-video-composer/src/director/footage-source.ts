// The clip file a footage edit analyses, and its probe: a project_video's recording (the same file the
// director already probes for its length), or a `video` section's source — a reused project clip, its
// `videoUrl` (staged here into the template's media cache, so the segment's own asset fetch reuses the
// copy instead of downloading twice) or the assets-dir fallback.

import type { FFMpegInfos, Section } from '@/core/types';
import { assertSafeArgToken } from '../core/arg-guard';
import { resolveSectionSource, type SectionInfosDeps } from './section-infos';

export interface FootageSourceDeps extends SectionInfosDeps {
  /** template.assets.inputs: staged media keyed by URL (AssetManager's cache). */
  mediaCache: Record<string, string>;
}

async function stageVideoUrl(deps: FootageSourceDeps, section: Section, url: string): Promise<string | null> {
  if (url.includes('{{')) {
    deps.logger.warn(`[Footage] ${section.name}: videoUrl uses a variable, so the clip is not analysed before render`);

    return null;
  }

  const cached = deps.mediaCache[url] as string | undefined;

  if (cached) return cached;

  const local = await deps.filesystemAdapter.resolveLocalAsset(url);
  const target = `${await deps.filesystemAdapter.getBuildPath('assets')}/${section.name}.${url.split('.').pop() ?? 'mp4'}`;

  if (!local) await deps.filesystemAdapter.move(await deps.filesystemAdapter.fetch(url), target);

  deps.mediaCache[url] = local ?? target;

  return deps.mediaCache[url];
}

/** The local file a video/project_video section's footage comes from, or null when it cannot be known yet. */
export async function footageSource(deps: FootageSourceDeps, section: Section): Promise<string | null> {
  if (section.type === 'project_video') return resolveSectionSource(deps, section);

  const options = section.options;

  if (options?.useVideoSection) return deps.filesystemAdapter.getSource(options.useVideoSection);

  if (options?.videoUrl) return stageVideoUrl(deps, section, options.videoUrl);

  return deps.filesystemAdapter.getSource(section.name);
}

/** Probe a footage source, or null when the adapter can't (the edit then runs on declared lengths). */
export async function probeFootage(deps: FootageSourceDeps, source: string): Promise<FFMpegInfos | null> {
  try {
    return await deps.ffmpegAdapter.getInfos(assertSafeArgToken(source, 'source'));
  } catch (error) {
    deps.logger.warn(`[Footage] probe failed for ${source}: ${error instanceof Error ? error.message : String(error)}`);

    return null;
  }
}
