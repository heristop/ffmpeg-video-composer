import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { ConfirmRequest } from '@/application/usecases/webmcp/types';
import { ConfirmDialog } from '../confirm-dialog';
import type { BuilderAgent } from './use-builder-agent';

// The head of the browser agent's confirmation queue, inside the shell's 'agent' overlay (over the agent
// drawer when that is open). Cancel takes the initial focus, Escape and dismissal decline, and the agent
// hears `user_declined`. The page words what will happen from the tool and its facts (a render's
// estimated time, the sample's title); the agent's own note is shown as plain text after it, never
// instead of it. A render may be allowed for the rest of the session.

const DETAILED = new Set<ConfirmRequest['tool']>([
  'replace_template',
  'load_sample',
  'render_preview',
  'save_template',
]);

function describe(request: ConfirmRequest, t: TFunction<'agent'>): string {
  const action = t(`actions.${request.tool as 'edit_template'}`);
  const parts = [t('confirm.description', { action })];

  if (DETAILED.has(request.tool) && request.detail) {
    parts.push(t(`confirm.details.${request.tool as 'load_sample'}`, request.detail));
  }

  if (request.kind === 'edit') parts.push(t('confirm.undoable'));

  if (request.note) parts.push(t('log.note', { note: request.note }));

  return parts.join(' ');
}

interface PendingProps {
  pending: NonNullable<BuilderAgent['confirm']>;
  answer: BuilderAgent['answer'];
}

const PendingConfirmation = ({ pending, answer }: PendingProps) => {
  const { t } = useTranslation('agent');
  const [remember, setRemember] = useState(false);
  const { request } = pending;

  return (
    <ConfirmDialog
      open
      raised
      title={t('confirm.title')}
      description={describe(request, t)}
      cancelLabel={t('confirm.deny')}
      confirmLabel={t('confirm.allow')}
      tone={request.kind === 'consequential' ? 'danger' : 'primary'}
      onConfirm={() => {
        answer(pending.id, true, remember);
      }}
      onCancel={() => {
        answer(pending.id, false);
      }}
    >
      {request.sessionAllowable ? (
        <label className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => {
              setRemember(event.target.checked);
            }}
            className="size-4 accent-brand-500"
          />
          {t('confirm.allowSession')}
        </label>
      ) : null}
    </ConfirmDialog>
  );
};

export const AgentConfirmDialog = ({ agent }: { agent: Pick<BuilderAgent, 'confirm' | 'answer'> }) =>
  agent.confirm ? <PendingConfirmation key={agent.confirm.id} pending={agent.confirm} answer={agent.answer} /> : null;
