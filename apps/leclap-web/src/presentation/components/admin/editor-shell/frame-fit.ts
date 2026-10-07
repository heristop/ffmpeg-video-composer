import type { EditorState } from '../templateEditorModel';

// The monitor frame at the output's exact aspect, as large as the stage allows on BOTH axes: the stage is a
// size container and the frame's width is min(stage width, stage height × aspect), its height following
// from aspect-ratio. Capping only one axis (w-full + max-h-full) let a short stage squash the height while
// the width stayed full, so the frame came out wider than 16:9 (and rings drawn on it oval).

/** The stage around the frame: centres it and is the size container the frame measures against. */
export const FRAME_STAGE_CLASS = 'grid h-full place-items-center p-4 sm:p-6 [container-type:size]';

/** The frame's size classes per orientation (aspect + width fitted to the stage). */
export const FRAME_FIT_CLASS: Record<EditorState['orientation'], string> = {
  landscape: 'aspect-video w-[min(100cqw,calc(100cqh*16/9))]',
  portrait: 'aspect-[9/16] w-[min(100cqw,calc(100cqh*9/16))]',
  square: 'aspect-square w-[min(100cqw,100cqh)]',
};
