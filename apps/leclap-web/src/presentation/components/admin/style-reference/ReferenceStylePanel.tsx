// "Match a reference": pick a reference image (and optionally a short clip), analyse its palette,
// texture and pacing in the browser, preview the derived theme with contrast badges, then hand it to
// the host — the builder applies it as global.theme, the AI dialog uses it as a binding style guide.
// Nothing about the reference's subjects, logos or text is read or kept.
import { useId, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Film, Image, Loader2, Sparkles, Trash2 } from '@/presentation/components/icons';
import { Button } from '@/presentation/components/ui';
import type { ReferenceStyle } from '@/infrastructure/style/analyze-reference';
import { isReferenceClip, isReferenceImage } from './reference-style.logic';
import { StyleSwatches } from './StyleSwatches';
import { useReferenceStyle } from './use-reference-style';

interface FilePickProps {
  label: string;
  accept: string;
  file: File | null;
  icon: ReactNode;
  disabled: boolean;
  accepts: (file: File) => boolean;
  onChange: (file: File | null) => void;
}

const FilePick = ({ label, accept, file, icon, disabled, accepts, onChange }: FilePickProps) => {
  const { t } = useTranslation('admin');
  const input = useRef<HTMLInputElement>(null);
  const id = useId();

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <input
        ref={input}
        id={id}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const picked = event.target.files?.[0] ?? null;
          onChange(picked && accepts(picked) ? picked : null);
          event.target.value = '';
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-10"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        {icon}
        {label}
      </Button>
      {file && (
        <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <span className="truncate">{file.name}</span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onChange(null);
            }}
            aria-label={t('styleReference.remove', { name: file.name })}
            className="tap rounded-lg p-1.5 transition-colors hover:text-[var(--color-error)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            <Trash2 aria-hidden className="size-3.5" />
          </button>
        </span>
      )}
    </div>
  );
};

export interface ReferenceStylePanelProps {
  /** Label of the button that hands the analysed style to the host. */
  applyLabel: string;
  onApply: (style: ReferenceStyle) => void;
  disabled?: boolean;
  /** Extra content under the preview (e.g. "attached" state). */
  footer?: ReactNode;
}

export const ReferenceStylePanel = ({ applyLabel, onApply, disabled = false, footer }: ReferenceStylePanelProps) => {
  const { t } = useTranslation('admin');
  const reference = useReferenceStyle();
  const running = reference.run.kind === 'running';
  const busy = disabled || running;

  return (
    <div className="grid gap-3">
      <p className="text-xs text-pretty text-muted-foreground">{t('styleReference.hint')}</p>
      <div className="grid gap-2">
        <FilePick
          label={t('styleReference.image')}
          accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif"
          file={reference.image}
          icon={<Image aria-hidden />}
          disabled={busy}
          accepts={isReferenceImage}
          onChange={reference.setImage}
        />
        <FilePick
          label={t('styleReference.clip')}
          accept="video/*"
          file={reference.clip}
          icon={<Film aria-hidden />}
          disabled={busy}
          accepts={isReferenceClip}
          onChange={reference.setClip}
        />
      </div>
      <div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="min-h-10"
          disabled={busy || (!reference.image && !reference.clip)}
          onClick={() => {
            reference.analyse().catch(() => {});
          }}
        >
          {running ? (
            <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" />
          ) : (
            <Sparkles aria-hidden />
          )}
          {t('styleReference.analyse')}
        </Button>
      </div>
      <p role="status" aria-live="polite" className="text-xs text-muted-foreground empty:hidden">
        {running ? t('styleReference.analysing') : ''}
      </p>
      {reference.run.kind === 'error' && (
        <p role="alert" className="text-xs text-[var(--color-warning)]">
          {t('styleReference.error', { message: reference.run.message })}
        </p>
      )}
      {reference.run.kind === 'ready' && (
        <ReadyPreview style={reference.run.style} applyLabel={applyLabel} onApply={onApply} disabled={disabled} />
      )}
      {footer}
    </div>
  );
};

const ReadyPreview = ({
  style,
  applyLabel,
  onApply,
  disabled,
}: {
  style: ReferenceStyle;
  applyLabel: string;
  onApply: (style: ReferenceStyle) => void;
  disabled: boolean;
}) => (
  <div className="grid gap-3 rounded-xl border border-divider bg-foreground/[0.03] p-3">
    <StyleSwatches analysis={style.analysis} />
    <div>
      <Button
        type="button"
        size="sm"
        className="min-h-10"
        disabled={disabled}
        onClick={() => {
          onApply(style);
        }}
      >
        {applyLabel}
      </Button>
    </div>
  </div>
);
