import React from 'react';
import type { useSaveProject } from '@/src/hooks/useProjects';
import type { Project } from '@/src/types';
import { CaptionsPanel } from './captions-panel';
import { useSectionCaptions } from './use-section-captions';

interface SectionCaptionsProps {
  project: Project | null | undefined;
  sectionName: string | undefined;
  clipPath: string | undefined;
  saveProjectMutation: ReturnType<typeof useSaveProject>;
  onClose: () => void;
}

function SectionCaptionsPanel({ project, sectionName, clipPath, saveProjectMutation, onClose }: SectionCaptionsProps) {
  const captions = useSectionCaptions({ project, sectionName, clipPath, saveProjectMutation });

  return (
    <CaptionsPanel
      captions={captions.captions}
      enabled={captions.enabled}
      status={captions.status}
      error={captions.error}
      onToggle={captions.setEnabled}
      onWordsChange={captions.updateWords}
      onRetry={() => {
        captions.retry().catch(console.error);
      }}
      onClose={onClose}
    />
  );
}

/** The preview screen's captions mode for one recorded video step (mounted only while visible). */
export function SectionCaptions({ visible, ...props }: SectionCaptionsProps & { visible: boolean }) {
  return visible ? <SectionCaptionsPanel {...props} /> : null;
}
