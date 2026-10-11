import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Check, Copy } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/presentation/components/ui';
import { SITE_URL } from '@/config/site';
import { embedSnippet, type EmbedRef, type EmbedShape } from './embed.logic';

/** What a player needs to offer its embed code. */
export interface PlayerEmbed {
  ref: EmbedRef;
  /** The iframe's title: the video's name. */
  title: string;
  shape: EmbedShape;
}

const TOAST_MS = 2400;

/**
 * A brief toast at the foot of the viewport: one line, a check, gone after a couple of seconds. It is a polite
 * live region, so a screen reader hears it too; reduced motion drops its rise (index.css).
 */
function Toast({ message, tone, onDone }: { message: string; tone: 'success' | 'error'; onDone: () => void }) {
  useEffect(() => {
    const id = setTimeout(onDone, TOAST_MS);

    return () => {
      clearTimeout(id);
    };
  }, [onDone]);

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[80] flex justify-center px-4">
      <p
        role="status"
        className="dark rise-in flex items-center gap-2 rounded-full border border-divider bg-surface-2 px-4 py-2.5 text-sm font-medium text-foreground shadow-[var(--shadow-lg)]"
      >
        {tone === 'success' && <Check className="size-4 text-success-foreground" aria-hidden="true" />}
        {message}
      </p>
    </div>,
    document.body
  );
}

/**
 * "Embed this video": the snippet in a read-only field that selects itself on focus, and a copy button that confirms
 * with a toast. The dialog is the app's own (Radix: focus trap, Escape, scroll lock).
 */
export function EmbedDialog({
  embed,
  open,
  onOpenChange,
}: {
  embed: PlayerEmbed;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('player');
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const snippet = embedSnippet({ origin: SITE_URL, ref: embed.ref, title: embed.title, shape: embed.shape });

  const copy = () => {
    navigator.clipboard
      .writeText(snippet)
      .then(() => {
        setToast({ message: t('copied'), tone: 'success' });
      })
      .catch(() => {
        setToast({ message: t('copyFailed'), tone: 'error' });
      });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-xl">
          <DialogHeader className="pr-10">
            <DialogTitle>{t('embedTitle')}</DialogTitle>
            <DialogDescription>{t('embedDescription')}</DialogDescription>
          </DialogHeader>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
              {t('embedCode')}
            </span>
            <textarea
              readOnly
              value={snippet}
              rows={6}
              spellCheck={false}
              onFocus={(event) => {
                event.currentTarget.select();
              }}
              className="block w-full resize-none rounded-xl border border-divider bg-surface-inset p-3 font-mono text-xs leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
            />
          </label>
          <div className="mt-4 flex justify-end">
            <Button onClick={copy} className="min-h-11">
              <Copy aria-hidden="true" />
              {t('copy')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {toast && (
        <Toast
          message={toast.message}
          tone={toast.tone}
          onDone={() => {
            setToast(null);
          }}
        />
      )}
    </>
  );
}
