// What the scene canvas hands the (lazy) live effect preview: the template context an effect's plan reads,
// and which effect is selected. Eager and tiny: type imports only, so the preview's engine code loads with
// the lazy layer, not with the builder.
import type { Graphic } from 'ffmpeg-video-composer/src/schemas/graphics.schemas.ts';
import type { EditorSection, EditorState } from '../../templateEditorModel';
import type { SectionSelectionState } from '../useSectionSelection';
import type { PreviewEnv } from './fx-context';

/** A section length the preview can loop within when the section has none (camera scenes are open-ended). */
const OPEN_SECTION = 12;

export function sectionSeconds(section: EditorSection): number {
  const duration = 'duration' in section ? section.duration : undefined;

  return typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : OPEN_SECTION;
}

/** The section's engine graphics (effects and strokes), or an empty list. */
export function sectionGraphics(section: EditorSection): Graphic[] {
  return 'graphics' in section ? (section.graphics ?? []) : [];
}

/** The template context of `section` for the effect preview. */
export function previewEnvOf(state: EditorState, section: EditorSection, reduced: boolean): PreviewEnv {
  return {
    orientation: state.orientation,
    section,
    sectionIndex: Math.max(0, state.sections.indexOf(section)),
    sectionSeconds: sectionSeconds(section),
    theme: state.motion?.theme,
    globalSeed: state.motion?.seed,
    tokens: state.motion?.tokens,
    reduced,
  };
}

/** The index of the selected engine effect in `section.graphics`, or undefined when none is selected. */
export function selectedEffect(section: EditorSection, selection: SectionSelectionState): number | undefined {
  const element = selection.element;

  if (element?.kind !== 'effect') return undefined;

  return sectionGraphics(section)[element.index] ? element.index : undefined;
}
