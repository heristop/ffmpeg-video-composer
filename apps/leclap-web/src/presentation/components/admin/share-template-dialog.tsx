import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ArrowUpRight } from '@/presentation/components/icons';
import { GithubIcon } from '@/presentation/components/icons/github';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/presentation/components/ui';
import { REPO_URL } from '@/config/site';
import type { Template } from '@/services/templateService';
import { useReturnFocus } from './use-return-focus';

// One step of an ordered list: the list carries the numbering for assistive tech, the badge shows it.
const Step = ({
  index,
  done,
  label,
  children,
}: {
  index: number;
  done: boolean;
  label: string;
  children: ReactNode;
}) => (
  <li className="flex gap-3">
    <span
      aria-hidden
      className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors duration-300 motion-reduce:transition-none ${
        done ? 'bg-brand-500/20 text-brand-300' : 'bg-foreground/[0.08] text-muted-foreground'
      }`}
    >
      {index}
    </span>
    <div className="min-w-0 flex-1 space-y-2">
      <p className="text-sm font-medium text-foreground">{label}</p>
      {children}
    </div>
  </li>
);

// "Contribute on GitHub" in two steps: copy the descriptor, then open the repo to paste it into a pull
// request. LeClap never posts anything itself — the author does the upload. Step 2's badge lights up
// once the JSON is on the clipboard.
export const ShareTemplateDialog = ({ template, onClose }: { template: Template | null; onClose: () => void }) => {
  const { t } = useTranslation('admin');
  const [copyState, setCopyState] = useState(() => ({ template, copied: false }));

  if (copyState.template !== template) setCopyState({ template, copied: false });
  const copied = copyState.template === template && copyState.copied;
  const returnFocus = useReturnFocus();
  const json = template ? JSON.stringify(template.descriptor, null, 2) : '';

  // "Copied" is a brief acknowledgement: it clears after two seconds and whenever another template opens.
  useEffect(() => {
    const timer = copied
      ? window.setTimeout(() => {
          setCopyState((current) => (current.template === template ? { ...current, copied: false } : current));
        }, 2000)
      : undefined;

    return () => {
      window.clearTimeout(timer);
    };
  }, [copied, template]);

  return (
    <Dialog
      open={template !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent {...returnFocus}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8">
            <GithubIcon className="size-5" />
            {t('card.shareDialog.title')}
          </DialogTitle>
          <DialogDescription>{t('card.shareDialog.description')}</DialogDescription>
        </DialogHeader>
        {/* min-w-0: a grid child otherwise sizes the dialog's track to the JSON's longest line. */}
        <ol className="min-w-0 space-y-5">
          <Step index={1} done label={t('card.shareDialog.step1')}>
            {/* A labelled, focusable region: the JSON scrolls both ways, and keyboard users need to reach it. */}
            <pre
              role="region"
              tabIndex={0}
              aria-label={t('card.shareDialog.jsonLabel')}
              className="max-h-40 overflow-auto rounded-lg border border-foreground/10 bg-background p-3 text-xs leading-relaxed text-foreground/75"
            >
              {json}
            </pre>
            <Button
              variant="outline"
              size="sm"
              className="min-h-10 w-full gap-2"
              onClick={() => {
                navigator.clipboard
                  .writeText(json)
                  .then(() => {
                    setCopyState({ template, copied: true });
                  })
                  .catch(() => {});
              }}
            >
              {copied && <Check className="size-4 text-[var(--color-success)]" />}
              <span aria-live="polite">{copied ? t('card.shareDialog.copied') : t('card.shareDialog.copy')}</span>
            </Button>
          </Step>
          <Step index={2} done={copied} label={t('card.shareDialog.step2')}>
            <Button asChild className="min-h-10 w-full gap-2">
              <a href={REPO_URL} target="_blank" rel="noopener noreferrer" onClick={onClose}>
                <GithubIcon className="size-4" />
                {t('card.shareDialog.openGithub')}
                <ArrowUpRight aria-hidden="true" className="size-4" />
              </a>
            </Button>
          </Step>
        </ol>
      </DialogContent>
    </Dialog>
  );
};
