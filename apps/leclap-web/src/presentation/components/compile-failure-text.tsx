import { useTranslation } from 'react-i18next';
import type { CompileFailure } from '@/application/usecases/compile-failure';

// Why a render failed, in the viewer's language. When the engine said something the app has no words of
// its own for, its line follows verbatim (English, as the engine speaks), ready to paste into a bug
// report. Inline content: each screen sets it in its own alert box.
export function CompileFailureText({ failure }: { failure: CompileFailure }) {
  const { t } = useTranslation('common');

  return (
    <>
      {t(`compileError.${failure.kind}`)}
      {failure.kind === 'appUpdated' ? (
        <button
          type="button"
          onClick={() => {
            window.location.reload();
          }}
          className="mt-2 block rounded-md border border-current px-2.5 py-1 text-xs font-semibold"
        >
          {t('compileError.reload')}
        </button>
      ) : null}
      {failure.detail ? (
        <code className="mt-1.5 block font-mono text-xs font-normal wrap-anywhere">{failure.detail}</code>
      ) : null}
    </>
  );
}
