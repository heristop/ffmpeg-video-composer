// The builder's entry points to Generate with AI: the titlebar button, and the dialog itself loaded
// lazily — its prompt material (engine schema, sample templates, motion catalog) and provider
// adapters ship in a separate chunk fetched the first time the dialog opens.
import { lazy, Suspense, useState } from 'react';
import type { TFunction } from 'i18next';
import { Sparkles } from '@/presentation/components/icons';
import type { EditorState } from '../templateEditorModel';

const GenerateWithAiDialog = lazy(() => import('./GenerateWithAiDialog'));

export const GenerateWithAiButton = ({ onClick, t }: { onClick: () => void; t: TFunction<'ai'> }) => (
  <button
    type="button"
    data-ai-trigger=""
    onClick={onClick}
    aria-label={t('open')}
    title={t('open')}
    className="tap inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-brand-500/40 bg-brand-500/10 px-2.5 text-sm font-semibold text-foreground transition-colors duration-200 hover:bg-brand-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 sm:px-3.5"
  >
    <Sparkles aria-hidden className="size-4 text-brand-300" />
    <span className="hidden lg:inline">{t('open')}</span>
  </button>
);

interface LazyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasUnsavedWork: boolean;
  onLoad: (state: EditorState) => void;
}

// Mounts the dialog on first open and keeps it mounted after, so a typed brief survives a close.
export const LazyGenerateWithAiDialog = (props: LazyDialogProps) => {
  const [wanted, setWanted] = useState(props.open);

  if (props.open && !wanted) setWanted(true);

  if (!wanted) return null;

  return (
    <Suspense fallback={null}>
      <GenerateWithAiDialog {...props} />
    </Suspense>
  );
};
