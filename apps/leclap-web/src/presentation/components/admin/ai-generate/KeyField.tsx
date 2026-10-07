// A masked API-key field bound to the key store: typing saves it (in this browser only), a reveal
// toggle checks what was pasted, a light format hint flags an obviously wrong key without blocking,
// and "Forget key" removes it. The privacy note says exactly where the key goes.
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, Shield, Trash2 } from '@/presentation/components/icons';
import { Input } from '@/presentation/components/ui';
import { useApiKey } from './use-api-key';

interface KeyFieldProps {
  providerId: string;
  providerLabel: string;
  placeholder: string;
  keyUrl: string;
  looksLikeKey?: (key: string) => boolean;
  // A fixed id for the input, so a host can focus it ("Add key"); generated when omitted.
  inputId?: string;
}

const LINK =
  'inline-flex items-center gap-1 rounded text-xs font-medium text-brand-300 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40';
const QUIET =
  'tap inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-divider px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40';

export const KeyField = ({ providerId, providerLabel, placeholder, keyUrl, looksLikeKey, inputId }: KeyFieldProps) => {
  const { t } = useTranslation('ai');
  const generatedId = useId();
  const id = inputId ?? generatedId;
  const { key, save, forget } = useApiKey(providerId);
  const [visible, setVisible] = useState(false);
  const [persistFailed, setPersistFailed] = useState(false);
  const [forgotten, setForgotten] = useState(false);
  const suspicious = key !== '' && looksLikeKey !== undefined && !looksLikeKey(key);

  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[0.8125rem] font-medium leading-tight text-foreground">
          {t('key.label', { provider: providerLabel })}
        </label>
        <a href={keyUrl} target="_blank" rel="noopener noreferrer" className={LINK}>
          {t('key.getKey')}
          <ArrowUpRight aria-hidden className="size-3" />
        </a>
      </div>
      <div className="flex gap-2">
        <Input
          id={id}
          type={visible ? 'text' : 'password'}
          value={key}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={`${id}-privacy`}
          aria-invalid={suspicious || undefined}
          className="h-10 font-mono text-sm"
          onChange={(event) => {
            setForgotten(false);
            setPersistFailed(!save(event.target.value) && event.target.value.trim() !== '');
          }}
        />
        <button
          type="button"
          className={QUIET}
          aria-pressed={visible}
          onClick={() => {
            setVisible((value) => !value);
          }}
        >
          {visible ? t('key.hide') : t('key.show')}
        </button>
        {key !== '' && (
          <button
            type="button"
            className={QUIET}
            onClick={() => {
              forget();
              setForgotten(true);
            }}
          >
            <Trash2 aria-hidden className="size-3.5" />
            <span className="max-sm:sr-only">{t('key.forget')}</span>
          </button>
        )}
      </div>
      <div aria-live="polite" className="grid gap-1 empty:hidden">
        {suspicious && (
          <p className="text-xs text-[var(--color-warning)]">
            {t('key.format', { provider: providerLabel, placeholder })}
          </p>
        )}
        {persistFailed && <p className="text-xs text-muted-foreground">{t('key.persistFailed')}</p>}
        {forgotten && <p className="text-xs text-muted-foreground">{t('key.forgotten')}</p>}
      </div>
      <p id={`${id}-privacy`} className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Shield aria-hidden className="mt-px size-3.5 shrink-0" />
        <span className="text-pretty">{t('key.privacy', { provider: providerLabel })}</span>
      </p>
    </div>
  );
};
