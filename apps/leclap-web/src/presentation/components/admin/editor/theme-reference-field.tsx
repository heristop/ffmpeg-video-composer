// The builder's theme entry point (Advanced panel): "Match a reference" derives a theme from a
// reference image or clip and applies it as global.theme in object form (EditorState.motion.theme),
// so every `$color.*` token in the template picks up the reference palette. One Undo reverts it.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EditorState } from '../templateEditorModel';
import { ReferenceStylePanel } from '../style-reference/ReferenceStylePanel';
import { withReferenceTheme } from '../style-reference/reference-style.logic';

interface ThemeReferenceFieldProps {
  state: EditorState;
  patch: (p: Partial<EditorState>) => void;
}

function currentThemeLabel(theme: unknown, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (typeof theme === 'string') return t('styleReference.current.named', { name: theme });

  return theme ? t('styleReference.current.custom') : t('styleReference.current.none');
}

export const ThemeReferenceField = ({ state, patch }: ThemeReferenceFieldProps) => {
  const { t } = useTranslation('admin');
  const [applied, setApplied] = useState(false);

  return (
    <section aria-labelledby="theme-reference-label" className="mt-4 border-t border-foreground/10 pt-4">
      <h3 id="theme-reference-label" className="text-xs font-semibold uppercase tracking-widest text-gray-400">
        {t('styleReference.label')}
      </h3>
      <p className="mt-1 mb-3 text-xs text-gray-500">{currentThemeLabel(state.motion?.theme, t)}</p>
      <ReferenceStylePanel
        applyLabel={t('styleReference.apply')}
        onApply={(style) => {
          patch({ motion: withReferenceTheme(state.motion, style.analysis) });
          setApplied(true);
        }}
        footer={
          <p role="status" aria-live="polite" className="text-xs text-muted-foreground empty:hidden">
            {applied ? t('styleReference.applied') : ''}
          </p>
        }
      />
    </section>
  );
};
