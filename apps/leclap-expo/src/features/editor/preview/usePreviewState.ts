import { useEffect, useRef, useState } from 'react';
import type { Project } from '@/src/types';
import type { NormalizedCrop } from '@/src/features/editor/components/CropOverlay';
import type { TrimRange } from '@/src/features/editor/components/TrimPanel';
import { type EditMode, FULL_CROP } from './previewHelpers';
import type { PreviewPlayer } from './usePreviewPlayer';

interface UsePreviewStateArgs {
  player: PreviewPlayer;
  seekTo: (seconds: number) => void;
  project: Project | null | undefined;
  sectionName: string | undefined;
  duration: number;
  currentTime: number;
}

export interface PreviewState {
  mode: EditMode;
  crop: NormalizedCrop;
  trim: TrimRange;
  setCrop: (next: NormalizedCrop) => void;
  setTrim: (next: TrimRange) => void;
  enterMode: (next: EditMode) => void;
  cancelMode: () => void;
  applyMode: () => void;
  resetCrop: () => void;
}

function seededEdits(project: Project | null | undefined, section: string, duration: number, seededFor: string) {
  const saved = project?.recordedVideos[section];

  return {
    seededFor,
    crop: saved?.crop ?? FULL_CROP,
    trim: saved?.trim ?? { start: 0, end: duration },
  };
}

/**
 * Owns the trim/crop editing state machine for the preview screen: seeds edits
 * from the saved section, loops playback within the trim window, pauses while
 * editing, and supports entering / cancelling / applying an edit mode.
 */
export function usePreviewState({
  player,
  seekTo,
  project,
  sectionName,
  duration,
  currentTime,
}: UsePreviewStateArgs): PreviewState {
  const [mode, setMode] = useState<EditMode>('view');
  const [edits, setEdits] = useState<{
    seededFor: string | null;
    crop: NormalizedCrop;
    trim: TrimRange;
  }>({ seededFor: null, crop: FULL_CROP, trim: { start: 0, end: 0 } });
  const crop = edits.crop;
  const trim = edits.trim;
  const setCrop = (next: NormalizedCrop) => {
    setEdits((current) => ({ ...current, crop: next }));
  };
  const setTrim = (next: TrimRange) => {
    setEdits((current) => ({ ...current, trim: next }));
  };
  // Snapshot to restore when the user cancels an edit mode.
  const snapshot = useRef<{ crop: NormalizedCrop; trim: TrimRange } | null>(null);
  // Key the initial edit values to the loaded clip so a new section starts with its saved crop/trim.
  const sectionKey = sectionName;
  const seededFor = sectionKey ? `${project?.id ?? 'new'}:${sectionKey}` : null;

  if (duration > 0 && sectionKey && seededFor && edits.seededFor !== seededFor) {
    setEdits(seededEdits(project, sectionKey, duration, seededFor));
  }

  // Loop playback within the trim window during preview.
  useEffect(() => {
    if (mode !== 'view') return;

    if (duration > 0 && currentTime >= trim.end - 0.05 && trim.end > 0) {
      seekTo(trim.start);
    }
  }, [currentTime, trim, duration, mode, seekTo]);

  // Pause while editing (stable frame for cropping / seeking); resume in view mode.
  useEffect(() => {
    if (mode === 'view') {
      player.play();

      return;
    }

    player.pause();
  }, [mode, player]);

  const enterMode = (next: EditMode) => {
    snapshot.current = { crop, trim };
    setMode(next);
  };

  const cancelMode = () => {
    if (snapshot.current) {
      const saved = snapshot.current;
      setEdits((current) => ({ ...current, crop: saved.crop, trim: saved.trim }));
    }

    setMode('view');
  };

  const applyMode = () => {
    setMode('view');
  };

  const resetCrop = () => {
    setCrop(FULL_CROP);
  };

  return { mode, crop, trim, setCrop, setTrim, enterMode, cancelMode, applyMode, resetCrop };
}
