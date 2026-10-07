import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Bot, Undo2 } from '@/presentation/components/icons';
import { Sheet, SheetContent, SheetDescription, SheetTitle, type SheetSide } from '@/presentation/components/ui';
import { useMediaQuery } from '@/hooks/use-media-query';
import { cn } from '@/lib/utils';
import { entryTime, type ActivityEntry } from './agent-activity.logic';
import type { BuilderAgent } from './use-builder-agent';

// The browser agent's drawer, the shell's 'agent' overlay: docked right on wide screens (the builder stays
// in view beside it) and to the bottom on phones, like the Generate-with-AI drawer. A pinned header
// (icon, title, intro) above a body that is the only thing that scrolls: the dev-mode notice, the two
// settings, and the recent calls, newest first, each with its outcome in words (never colour alone) and,
// for an edit that is still the present state, an Undo. Agent-written notes render as plain text.

// Wide enough for a side panel with the builder still readable beside it (same as the AI drawer).
const SIDE_PANEL_QUERY = '(min-width: 40rem)';

interface SwitchRowProps {
  label: string;
  help: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

const SwitchRow = ({ label, help, checked, disabled = false, onChange }: SwitchRowProps) => {
  const labelId = useId();
  const helpId = useId();

  return (
    <div className="flex items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <p id={labelId} className={cn('text-sm font-medium text-foreground', disabled && 'opacity-50')}>
          {label}
        </p>
        <p id={helpId} className="text-xs leading-snug text-muted-foreground">
          {help}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={helpId}
        disabled={disabled}
        onClick={() => {
          onChange(!checked);
        }}
        className={cn(
          'tap relative mt-0.5 inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:opacity-40',
          checked ? 'border-brand-500 bg-brand-500' : 'border-foreground/20 bg-foreground/10'
        )}
      >
        <span
          aria-hidden
          className={cn(
            'size-4.5 rounded-full bg-white shadow transition-transform motion-reduce:transition-none',
            checked ? 'translate-x-[1.1rem]' : 'translate-x-0.5'
          )}
        />
      </button>
    </div>
  );
};

const STATUS_TONE: Record<ActivityEntry['status'], string> = {
  ok: 'bg-[var(--color-success)]/12 text-[var(--color-success)]',
  error: 'bg-[var(--color-error)]/12 text-[var(--color-error)]',
  declined: 'bg-[var(--color-warning)]/12 text-[var(--color-warning)]',
};

interface EntryRowProps {
  entry: ActivityEntry;
  canUndo: boolean;
  onUndo: () => void;
  t: TFunction<'agent'>;
  locale: string;
}

const EntryRow = ({ entry, canUndo, onUndo, t, locale }: EntryRowProps) => {
  const action = t(`tools.${entry.tool}`);
  // "Declined" already says the user declined; other codes add their reason.
  const reason = entry.code && entry.code !== 'user_declined' ? t(`errors.${entry.code}`) : null;

  return (
    <li className="flex items-start gap-3 border-t border-foreground/10 py-3 first:border-t-0">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-medium text-foreground">{action}</span>
          <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', STATUS_TONE[entry.status])}>
            {t(`log.status.${entry.status}`)}
            {reason ? ` · ${reason}` : ''}
          </span>
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
          {entryTime(entry.at, locale)}
          {entry.changed.length > 0 ? ` · ${t('log.changed', { count: entry.changed.length })}` : ''}
        </p>
        {entry.note ? (
          <p className="mt-0.5 break-words text-xs text-muted-foreground">{t('log.note', { note: entry.note })}</p>
        ) : null}
      </div>
      {canUndo ? (
        <button
          type="button"
          onClick={onUndo}
          aria-label={t('log.undoLabel', { action })}
          className="tap inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-foreground/15 px-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
        >
          <Undo2 aria-hidden className="size-3.5" />
          {t('log.undo')}
        </button>
      ) : null}
    </li>
  );
};

const EmptyLog = ({ t }: { t: TFunction<'agent'> }) => (
  <div className="grid justify-items-center gap-2 rounded-2xl border border-dashed border-foreground/15 px-4 py-8 text-center">
    <span className="grid size-10 place-items-center rounded-full bg-foreground/5 text-muted-foreground">
      <Bot aria-hidden className="size-5" />
    </span>
    <p className="text-sm font-medium text-foreground">{t('log.emptyTitle')}</p>
    <p className="max-w-[34ch] text-xs leading-snug text-pretty text-muted-foreground">{t('log.empty')}</p>
  </div>
);

const ActivityLog = ({ agent, t, locale }: { agent: BuilderAgent; t: TFunction<'agent'>; locale: string }) => {
  if (agent.entries.length === 0) return <EmptyLog t={t} />;

  return (
    <ol aria-label={t('log.title')}>
      {agent.entries.map((entry) => (
        <EntryRow
          key={entry.id}
          entry={entry}
          canUndo={agent.canUndo(entry)}
          onUndo={() => {
            agent.undo(entry);
          }}
          t={t}
          locale={locale}
        />
      ))}
    </ol>
  );
};

const Settings = ({ agent, t }: { agent: BuilderAgent; t: TFunction<'agent'> }) => (
  <div className="divide-y divide-foreground/10">
    <SwitchRow
      label={t('settings.enabled')}
      help={t('settings.enabledHelp')}
      checked={agent.settings.enabled}
      onChange={(enabled) => {
        agent.setSettings({ enabled });
      }}
    />
    <SwitchRow
      label={t('settings.askBeforeEdit')}
      help={t('settings.askBeforeEditHelp')}
      checked={agent.settings.askBeforeEdit}
      disabled={!agent.settings.enabled}
      onChange={(askBeforeEdit) => {
        agent.setSettings({ askBeforeEdit });
      }}
    />
  </div>
);

export const AgentDrawer = ({ agent }: { agent: BuilderAgent }) => {
  const { t, i18n } = useTranslation('agent');
  const side: SheetSide = useMediaQuery(SIDE_PANEL_QUERY) ? 'right' : 'bottom';

  return (
    <Sheet open={agent.drawerOpen} onOpenChange={agent.setDrawerOpen}>
      <SheetContent side={side} returnFocusTo="[data-agent-pill]" className="overflow-hidden" data-agent-drawer="">
        <header
          className={cn(
            'relative z-10 grid shrink-0 gap-1 border-b border-divider px-5 pb-4 sm:px-6',
            side === 'bottom' ? 'pt-2' : 'pt-5 sm:pt-6'
          )}
        >
          <SheetTitle className="flex items-center gap-2 pr-10 text-xl leading-tight tracking-tight sm:text-2xl">
            <Bot aria-hidden className="size-5 shrink-0 text-brand-400 sm:size-6" />
            {t('popover.title')}
          </SheetTitle>
          <SheetDescription className="max-w-[60ch] pr-6 text-[0.8125rem] leading-snug text-pretty text-muted-foreground">
            {t('popover.intro')}
          </SheetDescription>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 sm:px-6">
          {agent.support === 'polyfill' ? (
            <p className="mb-2 rounded-lg bg-foreground/5 px-3 py-2 text-xs text-muted-foreground">
              {t('popover.polyfill')}
            </p>
          ) : null}
          <Settings agent={agent} t={t} />
          {agent.problem ? (
            <p role="status" className="mt-2 text-xs text-[var(--color-warning)]">
              {t('settings.problem', { detail: agent.problem })}
            </p>
          ) : null}
          <h3 className="mb-1 mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('log.title')}
          </h3>
          <ActivityLog agent={agent} t={t} locale={i18n.language} />
        </div>
      </SheetContent>
    </Sheet>
  );
};
