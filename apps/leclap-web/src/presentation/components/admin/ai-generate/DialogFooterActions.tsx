// The dialog's single primary action changes with the run: Generate → Cancel while working → Write
// template on a plan under review → Open in builder when ready → Replace draft (with the reason
// spelled out) when that would replace edits.
import { useTranslation } from 'react-i18next';
import { useId, type ReactNode } from 'react';
import { AlertTriangle, ArrowRight, Info, Sparkles } from '@/presentation/components/icons';
import { Button, DialogFooter } from '@/presentation/components/ui';
import { isRunning, type RunStatus } from './ai-generation.logic';

interface DialogFooterActionsProps {
  status: RunStatus;
  confirming: boolean;
  canGenerate: boolean;
  // The live status (progress, errors), rendered inside the pinned footer.
  statusSlot?: ReactNode;
  // Why Generate is disabled, shown beside it (a disabled button never goes unexplained).
  blockedReason?: string;
  // An inline fix for the blocked reason (e.g. "Add key" opening the key field).
  blockedAction?: { label: string; onClick: () => void };
  onGenerate: () => void;
  onCancel: () => void;
  onOpen: () => void;
  onConfirmReplace: () => void;
  onKeepEditing: () => void;
  onRegenerate: () => void;
  // The plan review step: continue to the template (disabled while the plan is incomplete).
  onWritePlan?: () => void;
  canWritePlan?: boolean;
}

// Rendered in the panel's pinned footer so the primary action is always in reach. The run's status
// sits here too, beside the action that started it, so progress and errors are visible however far
// the form is scrolled.
const FooterBar = ({ status, children }: { status?: ReactNode; children: ReactNode }) => (
  <div className="grid gap-3">
    {status}
    {children}
  </div>
);

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
const KBD =
  'inline-grid h-5 min-w-5 place-items-center rounded border border-divider bg-surface-2 px-1 font-sans text-[0.6875rem] font-medium leading-none text-muted-foreground';

// The ⌘/Ctrl+Enter hint beside Generate; pointer-only (touch keyboards have no such chord).
const ShortcutHint = ({ ctrl }: { ctrl: string }) => (
  <span aria-hidden className="hidden items-center gap-1 [@media(pointer:fine)]:sm:inline-flex">
    <kbd className={KBD}>{IS_MAC ? '⌘' : ctrl}</kbd>
    <kbd className={KBD}>{'↵'}</kbd>
  </span>
);

type GenerateBarProps = Pick<
  DialogFooterActionsProps,
  'status' | 'statusSlot' | 'canGenerate' | 'blockedReason' | 'blockedAction' | 'onGenerate'
>;

// Idle / error: Generate, and — whenever it is disabled — why, with the fix one tap away.
const GenerateBar = ({
  status,
  statusSlot,
  canGenerate,
  blockedReason,
  blockedAction,
  onGenerate,
}: GenerateBarProps) => {
  const { t } = useTranslation('ai');
  const reasonId = useId();
  const blocked = !canGenerate && blockedReason;

  return (
    <FooterBar status={statusSlot}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {blocked && (
          <p id={reasonId} className="flex min-w-0 items-start gap-2 text-xs leading-snug text-muted-foreground">
            <Info aria-hidden className="mt-px size-3.5 shrink-0 text-brand-300" />
            <span className="text-pretty">
              {blockedReason}{' '}
              {blockedAction && (
                <button
                  type="button"
                  onClick={blockedAction.onClick}
                  className="tap rounded font-semibold whitespace-nowrap text-brand-300 underline decoration-brand-300/40 underline-offset-4 transition-colors hover:text-brand-200 hover:decoration-brand-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
                >
                  {blockedAction.label}
                </button>
              )}
            </span>
          </p>
        )}
        <div className="flex items-center gap-3 sm:ml-auto">
          {canGenerate && <ShortcutHint ctrl={t('footer.ctrlKey')} />}
          <Button
            disabled={!canGenerate}
            aria-describedby={blocked ? reasonId : undefined}
            aria-keyshortcuts="Meta+Enter Control+Enter"
            className="max-sm:w-full"
            onClick={onGenerate}
          >
            <Sparkles aria-hidden />
            {status.kind === 'error' ? t('actions.retry') : t('actions.generate')}
          </Button>
        </div>
      </div>
    </FooterBar>
  );
};

const ReplaceConfirm = ({
  onKeepEditing,
  onConfirmReplace,
}: Pick<DialogFooterActionsProps, 'onKeepEditing' | 'onConfirmReplace'>) => {
  const { t } = useTranslation('ai');

  return (
    <FooterBar>
      <p role="alert" className="flex items-start gap-2 text-sm text-pretty text-foreground">
        <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-[var(--color-warning)]" />
        {t('result.replaceWarning')}
      </p>
      <DialogFooter className="mt-0">
        <Button variant="ghost" onClick={onKeepEditing}>
          {t('actions.keep')}
        </Button>
        <Button onClick={onConfirmReplace}>{t('actions.replace')}</Button>
      </DialogFooter>
    </FooterBar>
  );
};

export const DialogFooterActions = (props: DialogFooterActionsProps) => {
  const { t } = useTranslation('ai');
  const { status } = props;

  if (props.confirming) {
    return <ReplaceConfirm onKeepEditing={props.onKeepEditing} onConfirmReplace={props.onConfirmReplace} />;
  }

  if (isRunning(status)) {
    return (
      <FooterBar status={props.statusSlot}>
        <DialogFooter className="mt-0">
          <Button variant="secondary" onClick={props.onCancel}>
            {t('actions.cancel')}
          </Button>
        </DialogFooter>
      </FooterBar>
    );
  }

  if (status.kind === 'plan-ready') {
    return (
      <FooterBar status={props.statusSlot}>
        <DialogFooter className="mt-0">
          <Button variant="ghost" onClick={props.onRegenerate}>
            {t('actions.startOver')}
          </Button>
          <Button disabled={props.canWritePlan === false} onClick={props.onWritePlan}>
            {t('actions.writeTemplate')}
            <ArrowRight aria-hidden />
          </Button>
        </DialogFooter>
      </FooterBar>
    );
  }

  if (status.kind === 'ready') {
    return (
      <FooterBar status={props.statusSlot}>
        <DialogFooter className="mt-0">
          <Button variant="ghost" onClick={props.onRegenerate}>
            {t('actions.regenerate')}
          </Button>
          <Button onClick={props.onOpen}>
            {t('actions.open')}
            <ArrowRight aria-hidden />
          </Button>
        </DialogFooter>
      </FooterBar>
    );
  }

  return (
    <GenerateBar
      status={status}
      statusSlot={props.statusSlot}
      canGenerate={props.canGenerate}
      blockedReason={props.blockedReason}
      blockedAction={props.blockedAction}
      onGenerate={props.onGenerate}
    />
  );
};
