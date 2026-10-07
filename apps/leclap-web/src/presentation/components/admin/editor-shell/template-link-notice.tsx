// What the builder says after opening a template link: the media the person must film, upload or pick
// again (they stayed on the author's machine), or why the link could not be opened. A floating card over
// the shell, so the template (or the empty builder) stays usable behind it.
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Info, ShieldCheck } from '@/presentation/components/icons';
import { Button } from '@/presentation/components/ui';
import type { RebindItem, TemplateLinkImport } from '@/application/usecases/template-link/open-template-link';

export type TemplateLinkOutcome =
  | Exclude<TemplateLinkImport, { kind: 'none' } | { kind: 'opened' }>
  | {
      kind: 'opened';
      rebind: RebindItem[];
    };

interface TemplateLinkNoticeProps {
  outcome: TemplateLinkOutcome;
  onDismiss: () => void;
}

const MAX_DETAILS = 5;
// `dark`: the editor shell is always dark, whatever the site theme, and the card sits over it.
const CARD =
  'dark fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-50 mx-auto max-w-md rounded-2xl border bg-surface/95 p-4 text-sm text-foreground shadow-[var(--shadow-lg)] backdrop-blur-xl sm:bottom-6';

export const TemplateLinkNotice = ({ outcome, onDismiss }: TemplateLinkNoticeProps) => {
  const { t } = useTranslation('admin');

  if (outcome.kind === 'opened' && outcome.rebind.length === 0) return null;

  const dismiss = (
    <div className="mt-3 flex justify-end">
      <Button variant="secondary" size="sm" onClick={onDismiss}>
        {t('link.dismiss')}
      </Button>
    </div>
  );

  if (outcome.kind === 'failed') {
    return (
      <div role="alert" className={`${CARD} border-[var(--color-error)]/40`}>
        <p className="flex items-center gap-2 font-semibold text-[var(--color-error)]">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          {t('link.errorTitle')}
        </p>
        <p className="mt-1.5 text-pretty">{t(`link.errors.${outcome.code}`)}</p>
        {outcome.details.length > 0 && (
          <ul className="mt-2 space-y-0.5 font-mono text-xs text-foreground/70">
            {outcome.details.slice(0, MAX_DETAILS).map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-pretty text-foreground/70">{t('link.errorHint')}</p>
        {dismiss}
      </div>
    );
  }

  return (
    <div role="status" className={`${CARD} border-foreground/10`}>
      <p className="flex items-center gap-2 font-semibold">
        <Info className="h-4 w-4 shrink-0 text-brand-500" aria-hidden />
        {t('link.rebindTitle')}
      </p>
      <p className="mt-1.5 text-pretty">{t('link.rebindBody')}</p>
      <ul className="mt-2 list-disc space-y-0.5 pl-5">
        {outcome.rebind.map((item, i) => (
          <li key={i} className="break-all">
            {item.section === null
              ? t('link.rebindWhole', { file: item.file, interpolation: { escapeValue: false } })
              : t('link.rebindScene', {
                  file: item.file,
                  section: item.section,
                  interpolation: { escapeValue: false },
                })}
          </li>
        ))}
      </ul>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-foreground/70">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {t('link.privacy')}
      </p>
      {dismiss}
    </div>
  );
};
