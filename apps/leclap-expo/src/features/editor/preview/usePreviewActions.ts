import { useState } from 'react';
import { useRouter } from 'expo-router';
import type { useSaveProject } from '@/src/hooks/useProjects';
import type { Project } from '@/src/types';
import type { NormalizedCrop } from '@/src/features/editor/components/CropOverlay';
import type { TrimRange } from '@/src/features/editor/components/TrimPanel';
import { hasSectionCaptions, isCaptionable } from '@/src/features/captions/caption-store';
import { isCropApplied, isTrimApplied } from './previewHelpers';

interface UsePreviewActionsArgs {
  project: Project | null | undefined;
  projectId: string | undefined;
  sectionName: string | undefined;
  requiredOrientation: 'portrait' | 'landscape' | 'square';
  saveProjectMutation: ReturnType<typeof useSaveProject>;
  trim: TrimRange;
  crop: NormalizedCrop;
  duration: number;
}

export interface PreviewActions {
  canEdit: boolean;
  /** A recorded video step: the captions editor is offered. */
  canCaption: boolean;
  /** The step has pinned captions. */
  captionsActive: boolean;
  saving: boolean;
  handleRetake: () => void;
  handleDone: () => Promise<void>;
}

/**
 * Persistence and navigation handlers for the preview screen: saving trim/crop
 * edits back onto the project, retaking the section, and closing the preview.
 */
export function usePreviewActions({
  project,
  projectId,
  sectionName,
  requiredOrientation,
  saveProjectMutation,
  trim,
  crop,
  duration,
}: UsePreviewActionsArgs): PreviewActions {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const canEdit = Boolean(projectId && sectionName && project?.recordedVideos[sectionName]);
  const canCaption = canEdit && isCaptionable(project, sectionName);
  const captionsActive = hasSectionCaptions(project, sectionName);

  const persistEdits = async () => {
    if (!canEdit || !project || !sectionName) return;

    const existing = project.recordedVideos[sectionName];
    const updated = {
      ...project,
      recordedVideos: {
        ...project.recordedVideos,
        [sectionName]: {
          ...existing,
          trim: isTrimApplied(trim, duration) ? trim : undefined,
          crop: isCropApplied(crop) ? crop : undefined,
        },
      },
      updatedAt: new Date().toISOString(),
    };

    await saveProjectMutation.mutateAsync(updated);
  };

  const handleRetake = () => {
    if (projectId && sectionName && project?.templateContent.sections) {
      const sectionToRetake = project.templateContent.sections.find((s) => s.name === sectionName);

      if (sectionToRetake) {
        router.replace({
          pathname: '/(fullscreen)/record-section',
          params: {
            projectId,
            sectionJson: JSON.stringify(sectionToRetake),
            orientation: requiredOrientation,
            retake: 'true',
          },
        });

        return;
      }
    }

    if (router.canGoBack()) {
      router.back();

      return;
    }

    router.replace('/(app)/videos');
  };

  const navigateAway = () => {
    if (project?.templateName && project.id) {
      router.replace({ pathname: '/template/[id]', params: { id: project.templateName, projectId: project.id } });

      return;
    }

    if (router.canGoBack()) {
      router.back();

      return;
    }

    router.replace('/(app)/videos');
  };

  const handleDone = async () => {
    if (!canEdit) {
      navigateAway();

      return;
    }

    setSaving(true);

    try {
      await persistEdits();
    } catch (error) {
      console.error('Failed to save edits:', error);
    } finally {
      setSaving(false);
      navigateAway();
    }
  };

  return { canEdit, canCaption, captionsActive, saving, handleRetake, handleDone };
}
