import type { Section } from 'ffmpeg-video-composer/src/core/types.d.ts';

export type VideoFilterStage = { beforeOverlay: number; filters: NonNullable<Section['filters']> };

export interface VideoFilterFields {
  // Advanced JSON processing around editable text; absent for ordinary builder scenes.
  filterStages?: VideoFilterStage[];
}

export interface VideoOverlaySlot {
  // Stable import slot for retained video filters; never emitted into the descriptor.
  filterSlot?: number;
}
