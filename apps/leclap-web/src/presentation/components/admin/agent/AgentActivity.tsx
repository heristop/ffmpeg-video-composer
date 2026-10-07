import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Bot } from '@/presentation/components/icons';
import { cn } from '@/lib/utils';
import type { PillState } from './agent-activity.logic';
import { AgentDrawer } from './AgentDrawer';
import type { BuilderAgent } from './use-builder-agent';

// The titlebar's browser-agent pill: what the agent is doing (off / ready / working) at a glance, and the
// button that opens its drawer (settings and recent activity). A polite live region outside the drawer
// announces a summary once the agent pauses.

const DOT: Record<PillState, string> = {
  off: 'bg-muted-foreground/50',
  idle: 'bg-[var(--color-success)]',
  working: 'bg-brand-400 motion-safe:animate-pulse',
};

const LiveRegion = ({ agent, t }: { agent: BuilderAgent; t: TFunction<'agent'> }) => (
  <p role="status" aria-live="polite" className="sr-only">
    {agent.live ? <span key={agent.live.id}>{t(`live.${agent.live.key}`, { count: agent.live.count })}</span> : null}
  </p>
);

export const AgentActivity = ({ agent }: { agent: BuilderAgent }) => {
  const { t } = useTranslation('agent');

  if (!agent.available) return null;

  const stateLabel = t(`pill.states.${agent.state}`);

  return (
    <>
      <button
        type="button"
        data-agent-pill={agent.state}
        aria-haspopup="dialog"
        aria-expanded={agent.drawerOpen}
        onClick={() => {
          agent.setDrawerOpen(true);
        }}
        aria-label={t('pill.aria', { state: stateLabel })}
        title={t('pill.aria', { state: stateLabel })}
        className="tap inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-foreground/15 bg-foreground/5 px-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 sm:px-3"
      >
        <span className="relative">
          <Bot aria-hidden className="size-4" />
          <span
            aria-hidden
            className={cn('absolute -right-1 -top-1 size-2 rounded-full ring-2 ring-surface', DOT[agent.state])}
          />
        </span>
        <span className="hidden lg:inline">{t('pill.label')}</span>
      </button>
      <AgentDrawer agent={agent} />
      <LiveRegion agent={agent} t={t} />
    </>
  );
};
