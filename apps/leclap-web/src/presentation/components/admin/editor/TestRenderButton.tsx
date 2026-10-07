// "Preview render": compile the CURRENT descriptor through the real WASM pipeline with PLACEHOLDER
// media (generated brand-gradient clips for project_video sections; form fields filled with their
// own labels) at native resolution with the ultrafast preset, so an author sees a draft of their
// template without real footage. Progress is shown with the existing ProgressDisplay; the output
// plays in a dialog. The button is disabled while a render runs; usePreviewRender guards against
// double-clicks and owns the render state.
import { useTranslation } from 'react-i18next';
import { Clapperboard, Download, AlertCircle } from '@/presentation/components/icons';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/presentation/components/ui';
import { CompileFailureText } from '@/presentation/components/compile-failure-text';
import { ProgressDisplay } from '@/presentation/components/ProgressDisplay';
import { VideoPreview } from '@/presentation/components/VideoPreview';
import type { EditorState } from '../templateEditorModel';
import { usePreviewRender, type PreviewRender } from './usePreviewRender';

interface TestRenderButtonProps {
  state: EditorState;
  // Hard validation errors block the render — same gate as Save.
  disabled?: boolean;
  // A lifted usePreviewRender(), so another caller can open this same dialog. The button keeps its own
  // state when none is passed.
  preview?: PreviewRender;
}

export const TestRenderButton = ({ state, disabled = false, preview }: TestRenderButtonProps) => {
  const { t } = useTranslation('admin');
  const own = usePreviewRender();
  const { open, rendering, progress, result, failure, start, onOpenChange } = preview ?? own;

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => {
          start(state).catch(() => {});
        }}
        disabled={disabled || rendering}
        // Icon-only on phones, where the titlebar's action row can't also fit its label beside the saves;
        // the aria-label names it either way.
        className="h-9 shrink-0 rounded-full px-2.5 sm:px-4"
        aria-label={t('testRender.ariaLabel')}
        title={t('testRender.preview')}
      >
        <Clapperboard className="size-4" />
        <span className="hidden sm:inline">{rendering ? t('testRender.rendering') : t('testRender.preview')}</span>
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        {/* Raised: the browser agent may start a render while its drawer is open. */}
        <DialogContent className="max-w-2xl" raised>
          <DialogHeader>
            <DialogTitle>{t('testRender.title')}</DialogTitle>
            <DialogDescription>{t('testRender.description')}</DialogDescription>
          </DialogHeader>

          {failure && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-[var(--color-error)]/30 bg-[var(--color-error)]/10 px-3.5 py-2.5 text-sm font-medium text-[var(--color-error)]"
            >
              <AlertCircle className="mt-px size-4 shrink-0" />
              <p className="min-w-0">
                <CompileFailureText failure={failure} />
              </p>
            </div>
          )}

          {rendering && <ProgressDisplay progress={progress} />}

          {result && !rendering && (
            <div className="space-y-3">
              <VideoPreview url={result.url} />
              <a
                href={result.url}
                download="preview.mp4"
                className="tap inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-gray-200"
              >
                <Download className="h-4 w-4" /> {t('testRender.download')}
              </a>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};
