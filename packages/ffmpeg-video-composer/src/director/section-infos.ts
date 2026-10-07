import type AbstractFFmpeg from '../platform/ffmpeg/AbstractFFmpeg';
import type AbstractFilesystem from '../platform/filesystem/AbstractFilesystem';
import type AbstractLogger from '../platform/logging/AbstractLogger';
import type { FFMpegInfos, LogParams, ProjectConfig, Section } from '@/core/types';
import { assertSafeArgToken, assertSafeSegmentName } from '../core/arg-guard';

// Everything TemplateDirector needs to find a section's clip and read its media info. Passed in rather
// than reaching back into the director so this stays a pure, testable unit.
export interface SectionInfosDeps {
  config: ProjectConfig;
  ffmpegAdapter: AbstractFFmpeg;
  filesystemAdapter: AbstractFilesystem;
  logger: AbstractLogger;
}

// The user-recorded clip for a project_video section, if one was supplied and exists on disk.
async function resolveUserVideoSource(deps: SectionInfosDeps, section: Section): Promise<string | undefined> {
  const userPath = deps.config.userVideoPaths?.[section.name];

  if (section.type !== 'project_video' || !userPath) {
    return undefined;
  }

  try {
    await deps.filesystemAdapter.stat(userPath);
    deps.logger.info(`[fetchSectionInfos] Using section-specific video for ${section.name}: ${userPath}`);

    return userPath;
  } catch (error) {
    const logParams: LogParams = error instanceof Error ? { message: error.message, stack: error.stack } : {};
    deps.logger.error(`[fetchSectionInfos] Error accessing section-specific video: ${userPath}`, logParams);

    return undefined;
  }
}

// A project_video section with no user recording falls back to the bundled catalog demo clip. When
// that clip isn't already staged under the assets dir, fetch it (the filesystem adapter resolves the
// catalog-relative path to the public library) and move it onto the assets-dir source path that both
// the probe and the segment's `-i` read. Best-effort: a failed stage leaves the probe to fall back to
// the declared duration rather than aborting the render.
async function stageDemoClip(deps: SectionInfosDeps, section: Section, source: string): Promise<void> {
  if (section.type !== 'project_video') {
    return;
  }

  try {
    if (await deps.filesystemAdapter.stat(source)) {
      return;
    }

    const downloaded = await deps.filesystemAdapter.fetch(`videos/${assertSafeSegmentName(section.name)}.mp4`);
    await deps.filesystemAdapter.move(downloaded, source);
    deps.logger.info(`[fetchSectionInfos] Staged catalog demo clip for ${section.name}: ${source}`);
  } catch (error) {
    deps.logger.warn(`[fetchSectionInfos] Could not stage demo clip for ${section.name}`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// Probe the clip, tolerating two failures by falling back to the section's declared `options.duration`:
// a probe that throws (a clip the WASM build can't demux — some browser/MediaRecorder MP4s) and a clip
// that advertises no duration. The render still runs; the section is trimmed to that length anyway.
// With no declared duration there's nothing to fall back to, so the original error propagates.
async function probeWithFallback(deps: SectionInfosDeps, section: Section, source: string): Promise<FFMpegInfos> {
  const declared = typeof section.options?.duration === 'number' ? section.options.duration : 0;

  let info: FFMpegInfos;

  try {
    info = await deps.ffmpegAdapter.getInfos(source);
  } catch (error) {
    if (declared <= 0) throw error;

    deps.logger.warn(`[fetchSectionInfos] Probe failed for ${section.name}; using declared duration ${declared}s`, {
      error: error instanceof Error ? error.message : String(error),
    });

    return { duration: declared, videoCodec: null, audioCodec: null, sampleRate: null };
  }

  if (info.duration !== null) return info;

  if (declared <= 0) throw new Error(`Duration not found for ${section.name}`);

  deps.logger.info(`[fetchSectionInfos] No probed duration for ${section.name}; using declared ${declared}s`);

  return { ...info, duration: declared };
}

// Safe `<buildDir>/<name>_output.mp4` path for a rendered section's output file — reuses the same
// segment-name guard as the asset-path fallback below, so a malicious/malformed section name can't
// traverse out of the build dir here either. Lives alongside the other section-derived-path helpers
// so TemplateDirector.append doesn't need its own `core/arg-guard` import for this one call site.
export function segmentOutputPath(buildDir: string | undefined, sectionName: string): string {
  return `${buildDir}/${assertSafeSegmentName(sectionName)}_output.mp4`;
}

// Resolve a section's clip source: the user recording, else the assets-dir fallback (staging the catalog
// demo clip there when needed). Also used by the footage plan to analyse the same file it probes.
export async function resolveSectionSource(deps: SectionInfosDeps, section: Section): Promise<string> {
  const userPaths = deps.config.userVideoPaths;
  deps.logger.info(`[fetchSectionInfos] Processing section ${section.name} (${section.type})`, {
    userVideoPaths: userPaths ? Object.keys(userPaths).join(', ') : 'none',
  });

  const resolvedSource = await resolveUserVideoSource(deps, section);
  // Guard the section name in the assets-dir fallback (prevents `../` traversal into a probed file)
  // and reject whitespace/NUL in the probed source token, mirroring the `-i` source guard.
  const source = assertSafeArgToken(
    resolvedSource ?? `${deps.filesystemAdapter.getAssetsDir('videos')}/${assertSafeSegmentName(section.name)}.mp4`,
    'source'
  );

  if (!resolvedSource) {
    deps.logger.info(`[fetchSectionInfos] Using default assets path for section ${section.name}: ${source}`);
    await stageDemoClip(deps, section, source);
  }

  return source;
}

// Resolve a section's clip source and read its media info, falling back to the declared duration when
// the probe can't.
export async function fetchSectionInfos(deps: SectionInfosDeps, section: Section): Promise<FFMpegInfos> {
  return probeWithFallback(deps, section, await resolveSectionSource(deps, section));
}
