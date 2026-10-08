import type { NormalizedCrop, VideoRect } from '@/src/features/editor/components/CropOverlay';
import type { TrimRange } from '@/src/features/editor/components/TrimPanel';

export type EditMode = 'view' | 'trim' | 'crop' | 'captions';

export const FULL_CROP: NormalizedCrop = { x: 0, y: 0, w: 1, h: 1 };

export function buildErrorMessage(
  projectError: unknown,
  projectId: string | undefined,
  _videoUri: string | undefined,
  project: { id: string; templateName: string } | null | undefined
): string | null {
  if (projectError) {
    return projectError instanceof Error ? projectError.message : 'Failed to load project';
  }

  if (!projectId && !_videoUri) {
    return 'No project ID or video URI provided';
  }

  if (!project && projectId) {
    return 'Project not found';
  }

  return null;
}

/** Displayed-video rect inside a container, honoring contentFit="contain". */
export function computeVideoRect(container: { width: number; height: number }, srcW: number, srcH: number): VideoRect {
  if (container.width <= 0 || container.height <= 0 || srcW <= 0 || srcH <= 0) {
    return { left: 0, top: 0, width: container.width, height: container.height };
  }

  const srcAspect = srcW / srcH;
  const containerAspect = container.width / container.height;

  if (srcAspect > containerAspect) {
    const width = container.width;
    const height = width / srcAspect;

    return { left: 0, top: (container.height - height) / 2, width, height };
  }

  const height = container.height;
  const width = height * srcAspect;

  return { left: (container.width - width) / 2, top: 0, width, height };
}

export const isCropApplied = (c: NormalizedCrop) => c.x > 0.001 || c.y > 0.001 || c.w < 0.999 || c.h < 0.999;

export const isTrimApplied = (t: TrimRange, duration: number) =>
  t.start > 0.05 || (duration > 0 && t.end < duration - 0.05);
