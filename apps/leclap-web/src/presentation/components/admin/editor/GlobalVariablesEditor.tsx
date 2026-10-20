// Author-defined template constants. Each row is a {name, value} pair that buildDescriptor merges into
// global.variables; insertable as {{ name }} in any overlay text. Extracted from TemplateEditor so both
// the legacy editor and the studio shell's Variables panel render the exact same authoring UI.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from '@/presentation/components/icons';
import { PlusIcon } from '@/presentation/components/icons/plus';
import { useIconHover } from '@/presentation/components/icons/useIconHover';
import { normalizeHex } from '@/lib/color';
import type { EditorState } from '../templateEditorModel';
import { EDITOR_INPUT_CLASS } from './editorStyles';
import { FieldGroupHeader } from './FieldGroupHeader';
import { allFieldNames, scenesUsing, variableNameProblem } from './SectionFields/form-fields.logic';

interface GlobalVariablesEditorProps {
  state: EditorState;
  patch: (p: Partial<EditorState>) => void;
}

// The line under a variable row: what is wrong with its name, else where the scenes show it.
function VariableNote({ state, index }: { state: EditorState; index: number }) {
  const { t } = useTranslation('admin');
  const { name } = state.globalVariables[index];
  const others = [
    ...state.globalVariables.filter((_, i) => i !== index).map((variable) => variable.name),
    ...allFieldNames(state),
  ];
  const problem = variableNameProblem(name, others);

  if (problem) {
    return <p className="col-span-3 text-xs text-[var(--color-error)]">{t(`editor.variables.problem.${problem}`)}</p>;
  }

  if (name.trim() === '') return null;

  const scenes = scenesUsing(state.sections, name);

  return (
    <p className="col-span-3 text-xs text-muted-foreground">
      {scenes.length > 0
        ? t('editor.variables.usedIn', { list: scenes.join(', '), count: scenes.length })
        : t('editor.variables.unused', { name })}
    </p>
  );
}

export const GlobalVariablesEditor = ({ state, patch }: GlobalVariablesEditorProps) => {
  const { t } = useTranslation('admin');
  const { globalVariables } = state;
  const { ref: plusRef, hoverProps: plusHoverProps } = useIconHover();
  // Index of a just-added row: its key input grabs focus on mount so "Add variable" flows straight
  // into typing the name (add + type = one uninterrupted gesture, no extra click).
  const [focusIndex, setFocusIndex] = useState<number | null>(null);

  const update = (i: number, p: Partial<EditorState['globalVariables'][number]>) => {
    patch({ globalVariables: globalVariables.map((v, idx) => (idx === i ? { ...v, ...p } : v)) });
  };

  return (
    <div>
      <FieldGroupHeader label={t('editor.variables.label')} hint={t('editor.variables.hint')} />
      <div className="space-y-2">
        {globalVariables.length === 0 && (
          <p className="rounded-lg border border-dashed border-foreground/15 px-3 py-2.5 text-xs text-gray-500 dark:text-gray-400">
            {t('editor.variables.empty')}
          </p>
        )}
        {globalVariables.map((variable, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-x-2 gap-y-1">
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-brand-600 dark:text-brand-300">
                #
              </span>
              <input
                ref={(node) => {
                  if (!node || focusIndex !== i) return;

                  node.focus();
                  setFocusIndex(null);
                }}
                aria-label={t('editor.variables.name', { index: i + 1 })}
                className={`${EDITOR_INPUT_CLASS} pl-7`}
                value={variable.name}
                onChange={(e) => {
                  update(i, { name: e.target.value });
                }}
                placeholder={t('editor.variables.namePlaceholder')}
              />
            </div>
            <div className="relative">
              <input
                aria-label={t('editor.variables.value', { index: i + 1 })}
                className={`${EDITOR_INPUT_CLASS} ${normalizeHex(variable.value) ? 'pr-11' : ''}`}
                value={variable.value}
                onChange={(e) => {
                  update(i, { value: e.target.value });
                }}
                placeholder={t('editor.variables.valuePlaceholder')}
              />
              {/* A colour-valued variable gets an inline swatch: the native picker edits it in place,
                  so palette variables are tweakable without leaving the Variables tool. */}
              {normalizeHex(variable.value) && (
                <input
                  type="color"
                  aria-label={t('editor.variables.colorValue', { index: i + 1 })}
                  value={normalizeHex(variable.value) ?? '#000000'}
                  onChange={(e) => {
                    update(i, { value: e.target.value });
                  }}
                  className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 cursor-pointer rounded-md border border-divider bg-transparent p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-moz-color-swatch]:rounded [&::-moz-color-swatch]:border-0"
                />
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                patch({ globalVariables: globalVariables.filter((_, idx) => idx !== i) });
              }}
              aria-label={t('editor.variables.remove', { index: i + 1 })}
              className="tap relative rounded-lg p-1.5 text-gray-500 transition-colors after:absolute after:-inset-2 after:content-[''] hover:text-[var(--color-error)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-error)]/40 active:scale-90"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <VariableNote state={state} index={i} />
          </div>
        ))}
        <button
          type="button"
          onClick={() => {
            setFocusIndex(globalVariables.length);
            patch({ globalVariables: [...globalVariables, { name: '', value: '' }] });
          }}
          className="tap inline-flex items-center gap-1.5 rounded-lg bg-foreground/5 px-2.5 py-1.5 text-xs text-gray-600 transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 active:scale-[0.97] dark:text-gray-300"
          {...plusHoverProps}
        >
          <PlusIcon ref={plusRef} size={14} /> {t('editor.variables.add')}
        </button>
      </div>
    </div>
  );
};
