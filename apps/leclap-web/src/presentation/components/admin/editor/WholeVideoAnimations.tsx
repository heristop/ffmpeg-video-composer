// Whole-video animation files (descriptor global.animations) — composited over the FINAL joined video
// so they span every section continuously, unlike a section's own animation file. Files only: engine
// effects are drawn per scene. Reuses the section animation
// list editor. Rendered as a collapsed SectionDisclosure in the Advanced tool — a finishing touch — whose
// summary chip reports the configured layer(s) without expanding.
import { useTranslation } from 'react-i18next';
import type { EditorState } from '../templateEditorModel';
import { AnimationOverlayField } from './AnimationOverlayField';
import { SectionDisclosure } from './SectionDisclosure';
import { animationSummary } from './sectionHints';

interface WholeVideoAnimationsProps {
  state: EditorState;
  patch: (p: Partial<EditorState>) => void;
}

export const WholeVideoAnimations = ({ state, patch }: WholeVideoAnimationsProps) => {
  const { t } = useTranslation('admin');

  return (
    <SectionDisclosure
      label={t('editor.advanced.wholeVideo.label')}
      summary={animationSummary(t, state.globalAnimations)}
    >
      <p className="text-xs text-gray-500 dark:text-gray-400">{t('editor.advanced.wholeVideo.hint')}</p>
      <AnimationOverlayField
        value={state.globalAnimations}
        orientation={state.orientation}
        onChange={(animations) => {
          patch({ globalAnimations: animations ?? [] });
        }}
      />
    </SectionDisclosure>
  );
};
