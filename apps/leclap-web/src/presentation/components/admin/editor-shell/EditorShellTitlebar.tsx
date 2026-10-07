import { useId, type ReactNode, type Ref } from 'react';
import type { TFunction } from 'i18next';
import { AlertCircle, ArrowLeft, Undo2, Redo2, Save, ArrowRight } from '@/presentation/components/icons';
import { cn } from '@/lib/utils';
import type { SaveFeedback } from './save-blocker.logic';

interface EditorShellTitlebarProps {
  name: string;
  onNameChange: (name: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onCancel: () => void;
  // Names where Back returns to ("Templates", "Studio"); defaults to the templates list.
  backLabel?: string;
  onSave: () => void;
  // When provided, a second "Save & film →" CTA appears that saves and jumps straight to the Builder.
  onSaveAndCompile?: () => void;
  // What the last save attempt came to — why it was refused ("Give your template a name."), shown until
  // fixed, or that the write failed — on a line under the bar, beside the Save buttons.
  feedback?: SaveFeedback | null;
  // The refused save was for want of a name: the name field is what needs attention.
  nameInvalid?: boolean;
  nameRef?: Ref<HTMLInputElement>;
  // Optional control rendered just before Save — the template editor passes its "Preview render" button.
  preview?: ReactNode;
  // Optional assist control rendered before the preview — the template editor's "Generate with AI".
  assist?: ReactNode;
  // Optional browser-agent (WebMCP) pill, rendered first in the action cluster.
  agent?: ReactNode;
  t: TFunction<'admin'>;
}

const IconButton = ({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    disabled={disabled}
    onClick={onClick}
    className="tap grid size-9 shrink-0 place-items-center rounded-lg border border-foreground/10 bg-foreground/5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:pointer-events-none disabled:opacity-40"
  >
    {children}
  </button>
);

const PRIMARY =
  'tap inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-brand-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50';
const SECONDARY =
  'tap inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-foreground/20 bg-surface text-sm font-semibold text-foreground transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50';

// Save, then "Save & film" when offered — most committal last, so the primary sits at the trailing
// edge. Beside "Save & film", Save steps down to the secondary style (icon-only on phones); alone, it is
// the primary and keeps its label everywhere.
const SaveActions = ({
  onSave,
  onSaveAndCompile,
  t,
}: Pick<EditorShellTitlebarProps, 'onSave' | 'onSaveAndCompile' | 't'>) => (
  <>
    <button
      type="button"
      onClick={onSave}
      aria-label={t('editor.save')}
      className={onSaveAndCompile ? cn(SECONDARY, 'px-2.5 sm:px-4') : PRIMARY}
    >
      <Save className="size-4" />
      <span className={onSaveAndCompile ? 'hidden sm:inline' : undefined}>{t('editor.save')}</span>
    </button>
    {onSaveAndCompile && (
      <button type="button" onClick={onSaveAndCompile} className={PRIMARY}>
        {t('editor.saveAndFilm')}
        <ArrowRight aria-hidden="true" className="size-4" />
      </button>
    )}
  </>
);

// The line under the bar after a save attempt: amber for what the author can fix, red for a failed
// write, with the validator's own (technical) wording set aside after the message.
const SaveFeedbackLine = ({ id, feedback }: { id: string; feedback: SaveFeedback }) => (
  <p
    id={id}
    role="alert"
    className={cn(
      'mt-1.5 flex items-start justify-end gap-1.5 text-xs font-medium max-sm:justify-start',
      feedback.tone === 'error' ? 'text-[var(--color-error)]' : 'text-[var(--color-warning)]'
    )}
  >
    <AlertCircle aria-hidden className="mt-px size-3.5 shrink-0" />
    <span className="min-w-0 text-pretty">
      {feedback.message}
      {feedback.detail && <span className="ml-1 font-normal opacity-80">{feedback.detail}</span>}
    </span>
  </p>
);

// The editor shell's top bar: a back pill, the inline-editable template name, undo/redo, Preview
// render, then the save actions. Save is never greyed out without a reason: a refused save names what's
// missing on a line under the bar (and the shell takes the author to it). On phones the bar wraps into
// two calm rows — back + name on top, the actions right-aligned below — and only the primary keeps its
// text label.
export const EditorShellTitlebar = ({
  name,
  onNameChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onCancel,
  backLabel,
  onSave,
  onSaveAndCompile,
  feedback,
  nameInvalid = false,
  nameRef,
  preview,
  assist,
  agent,
  t,
}: EditorShellTitlebarProps) => {
  const messageId = useId();
  const back = backLabel ?? t('editor.back');

  return (
    <header className="shrink-0 border-b border-foreground/10 bg-surface-2/50 px-4 py-2 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 sm:flex-nowrap sm:gap-3">
        <button
          type="button"
          onClick={onCancel}
          aria-label={back}
          className="tap group inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 sm:px-3"
        >
          <ArrowLeft className="size-4 transition-transform duration-300 group-hover:-translate-x-1 motion-reduce:transition-none" />
          <span className="hidden sm:inline">{back}</span>
        </button>
        {/* Inline-editable template name — click to rename right in the titlebar. */}
        <input
          ref={nameRef}
          type="text"
          value={name}
          onChange={(e) => {
            onNameChange(e.target.value);
          }}
          placeholder={t('editor.untitled')}
          aria-label={t('shell.nameLabel')}
          aria-invalid={nameInvalid || undefined}
          aria-describedby={nameInvalid && feedback ? messageId : undefined}
          // Morph target for the templates-list → editor View Transition: the card title grows into this input.
          // While invalid, the app's global focus outline turns amber too (inline, so it outranks that
          // unlayered rule), keeping one warning colour around the field rather than lavender over amber.
          style={{
            viewTransitionName: 'studio-title',
            ...(nameInvalid ? { outlineColor: 'var(--color-warning)' } : {}),
          }}
          className={cn(
            '-mx-1.5 min-w-0 flex-1 basis-32 truncate rounded-md bg-transparent px-1.5 py-0.5 font-display text-base font-bold text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 hover:bg-foreground/5 focus:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-brand-500/40',
            nameInvalid && 'ring-2 ring-[var(--color-warning)]/60 focus-visible:ring-[var(--color-warning)]/40'
          )}
        />
        {/* Action cluster — `w-full` forces the wrap onto its own right-aligned row on phones. */}
        <div className="flex w-full items-center justify-end gap-2 sm:w-auto sm:gap-3">
          {agent}
          <IconButton label={t('editor.toolbar.undo')} disabled={!canUndo} onClick={onUndo}>
            <Undo2 className="size-4" />
          </IconButton>
          <IconButton label={t('editor.toolbar.redo')} disabled={!canRedo} onClick={onRedo}>
            <Redo2 className="size-4" />
          </IconButton>
          {assist}
          {preview}
          <SaveActions onSave={onSave} onSaveAndCompile={onSaveAndCompile} t={t} />
        </div>
      </div>
      {feedback && <SaveFeedbackLine id={messageId} feedback={feedback} />}
    </header>
  );
};
