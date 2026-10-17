// Raw-JSON escape hatch for the studio shell's Advanced panel: the built descriptor as editable
// text, for the rare edit that's faster to type than to click through. Edits are local until Apply;
// Apply is the ONLY thing that touches the rest of the app (via onImport), and it goes through the
// exact same templateIO.importDescriptorJson the file-import button uses — no bespoke validation
// here. CodeMirror is lazy-loaded so its bundle weight stays out of the main chunk; a plain
// read-only <textarea> stands in as the Suspense fallback so the JSON is visible immediately.
import { Suspense, lazy, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from '@/presentation/components/icons';
import type { EditorState } from '../templateEditorModel';
import { FieldGroupHeader } from './FieldGroupHeader';
import {
  applyJsonEdit,
  createJsonEditorSnapshot,
  editJsonEditorSnapshot,
  stateChangedUnderneath,
  syncJsonEditorSnapshot,
} from './json-editor-state';
import { exportDescriptorJson, importDescriptorJson } from './templateIO';

interface JsonEditorPanelProps {
  state: EditorState;
  onImport: (next: EditorState) => void;
}

interface CodeEditorProps {
  value: string;
  onChange: (next: string) => void;
}

// @codemirror/lang-json + @uiw/react-codemirror only load once this component actually mounts.
const JsonCodeMirror = lazy(async () => {
  const [{ default: CodeMirror }, { json }] = await Promise.all([
    import('@uiw/react-codemirror'),
    import('@codemirror/lang-json'),
  ]);

  // `theme="dark"` unconditionally, NOT the app theme: the studio editor shell is dark-chromed in
  // both light and dark mode (its section paints oklch(0.235 …) with near-white text either way).
  // CodeMirror's default light palette paints property keys and punctuation near-black, which is
  // unreadable here; following the app theme instead would drop a white editor into the dark panel.
  const Editor = ({ value, onChange }: CodeEditorProps) => (
    <CodeMirror
      value={value}
      height="260px"
      theme="dark"
      extensions={[json()]}
      onChange={onChange}
      className="overflow-hidden rounded-lg border border-foreground/15 text-xs"
    />
  );

  return { default: Editor };
});

// The debounce window before the (non-applying) live validity check runs — long enough that a
// mid-word keystroke doesn't flash "invalid" on unbalanced brackets/quotes.
const VALIDITY_DEBOUNCE_MS = 400;

export const JsonEditorPanel = ({ state, onImport }: JsonEditorPanelProps) => {
  const { t } = useTranslation('admin');
  const exported = exportDescriptorJson(state);
  const [snapshot, setSnapshot] = useState(() => createJsonEditorSnapshot(exported));
  const [syncedExport, setSyncedExport] = useState(exported);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [applied, setApplied] = useState(false);
  const [valid, setValid] = useState(true);

  // Two-way sync: refresh the text from the form state only while the panel is clean. While dirty,
  // the snapshot is left untouched and stateChangedUnderneath below surfaces the conflict instead.
  if (exported !== syncedExport) {
    setSyncedExport(exported);
    setSnapshot((previous) => syncJsonEditorSnapshot(previous, exported));
  }

  // Debounced live-validity indicator. Re-uses importDescriptorJson (not a fresh schema call) so
  // there is exactly one validation seam in the app; the result here is display-only — Apply is
  // still the only thing that commits it.
  useEffect(() => {
    const handle = setTimeout(() => {
      setValid(importDescriptorJson(snapshot.text, state).ok);
    }, VALIDITY_DEBOUNCE_MS);

    return () => {
      clearTimeout(handle);
    };
  }, [snapshot.text, state]);

  const onEdit = (text: string): void => {
    setApplied(false);
    setSnapshot((previous) => editJsonEditorSnapshot(previous, text));
  };

  const onApply = (): void => {
    const outcome = applyJsonEdit(snapshot, state);

    if (!outcome.ok) {
      setApplied(false);
      setErrors(outcome.errors);

      return;
    }
    setErrors(null);
    setApplied(true);
    setValid(true);
    setSnapshot(outcome.snapshot);
    onImport(outcome.imported);
  };

  const changedUnderneath = stateChangedUnderneath(snapshot, exported);

  return (
    <div className="border-t border-foreground/10 pt-4">
      <FieldGroupHeader label={t('editor.advanced.jsonEditor.label')} hint={t('editor.advanced.jsonEditor.hint')} />
      <Suspense
        fallback={
          <textarea
            readOnly
            value={snapshot.text}
            rows={10}
            aria-label={t('editor.advanced.jsonEditor.label')}
            className="w-full rounded-lg border border-foreground/15 bg-surface-inset p-2.5 font-mono text-xs text-foreground"
          />
        }
      >
        <JsonCodeMirror value={snapshot.text} onChange={onEdit} />
      </Suspense>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onApply}
          className="tap inline-flex items-center gap-1.5 rounded-lg bg-foreground/5 px-2.5 py-1.5 text-xs text-gray-600 transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 active:scale-[0.97] dark:text-gray-300"
        >
          {t('editor.advanced.jsonEditor.apply')}
        </button>
        <span
          className={
            valid
              ? 'rounded-full bg-[var(--color-success)]/15 px-2 py-0.5 text-[0.65rem] font-medium text-[var(--color-success-foreground)]'
              : 'rounded-full bg-[var(--color-error)]/10 px-2 py-0.5 text-[0.65rem] font-medium text-[var(--color-error)]'
          }
        >
          {valid ? t('editor.advanced.jsonEditor.valid') : t('editor.advanced.jsonEditor.invalid')}
        </span>
        {snapshot.dirty && (
          <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[0.65rem] font-medium text-muted-foreground">
            {t('editor.advanced.jsonEditor.dirty')}
          </span>
        )}
      </div>
      {changedUnderneath && (
        <p
          role="status"
          className="mt-2 rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-2.5 text-xs text-foreground"
        >
          {t('editor.advanced.jsonEditor.stateChanged')}
        </p>
      )}
      {applied && !errors && (
        <p
          role="status"
          className="mt-3 flex items-center gap-1.5 rounded-lg border border-[var(--color-success)]/50 bg-[var(--color-success)]/15 p-2.5 text-xs font-medium text-[var(--color-success-foreground)]"
        >
          <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {t('editor.advanced.jsonEditor.applied')}
        </p>
      )}
      {errors && (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-[var(--color-error)]/30 bg-[var(--color-error)]/10 p-2.5 text-xs text-[var(--color-error)]"
        >
          <p className="font-semibold">{t('editor.importError.title')}</p>
          <ul className="mt-1 space-y-0.5">
            {errors.map((line, i) => (
              <li key={i} className="font-mono">
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
