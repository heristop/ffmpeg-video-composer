import { useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TemplateOrientation } from '@leclap/creative-kit';
import { X } from '@/presentation/components/icons';
import { RadioMark } from '@/presentation/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { useObjectUrl } from './useObjectUrl';

// Thumbs take the template's frame, so a take previews the way it will be used; one fixed 3:4 tile
// cropped a landscape take down to its middle.
const THUMB_SHAPE: Record<TemplateOrientation, string> = {
  landscape: 'aspect-video w-32',
  portrait: 'aspect-[9/16] w-20',
  square: 'aspect-square w-24',
};

// Where the poster frame is taken: a tenth of the way in (at most a second), past the black first
// frame a camera often starts on.
export function posterTime(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;

  return Math.min(1, duration / 10);
}

// 0:07, 1:12.
export function takeLength(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));

  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, '0')}`;
}

interface RushThumbProps {
  file: File;
  index: number;
  selected: boolean;
  shape: string;
  onSelect: () => void;
  onRemove: () => void;
}

// A single take cell: a poster frame with its length, the take's radio mark (top-left) and a remove
// control (top-right), both inside the tile so nothing hangs off it or collides. Selecting makes this
// the take the editor, preview and render use.
const RushThumb = ({ file, index, selected, shape, onSelect, onRemove }: RushThumbProps) => {
  const { t } = useTranslation('builder');
  const url = useObjectUrl(file);
  const [length, setLength] = useState<number | null>(null);
  const label = t('rush.take', { number: index + 1 });

  const onMetadata = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    setLength(video.duration);
    video.currentTime = posterTime(video.duration);
  };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        role="radio"
        onClick={onSelect}
        aria-checked={selected}
        aria-label={t('rush.use', { number: index + 1 })}
        className={cn(
          'group relative block overflow-hidden rounded-lg bg-surface-2 ring-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-brand-400',
          shape,
          selected ? 'ring-brand-500' : 'ring-foreground/10 hover:ring-foreground/30'
        )}
      >
        {url ? (
          <video
            src={url}
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={onMetadata}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="grid h-full w-full place-items-center text-[0.6rem] text-muted-foreground">{label}</span>
        )}
        <RadioMark checked={selected} className="absolute left-1.5 top-1.5 shadow-[0_1px_3px_oklch(0_0_0/0.35)]" />
        <span className="absolute inset-x-0 bottom-0 flex items-baseline justify-between gap-1 bg-linear-to-t from-black/75 to-transparent px-1.5 pb-1 pt-3 text-[0.62rem] font-semibold text-white">
          <span className="min-w-0 truncate">{label}</span>
          {length === null ? null : <span className="shrink-0 tabular-nums text-white/80">{takeLength(length)}</span>}
        </span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={t('rush.remove', { number: index + 1 })}
        title={t('rush.remove', { number: index + 1 })}
        className="absolute right-1 top-1 grid size-7 place-items-center rounded-full bg-black/55 text-white transition-colors before:absolute before:-inset-2 before:content-[''] hover:bg-[var(--color-error)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
};

interface RemoveConfirmProps {
  index: number;
  onConfirm: () => void;
  onCancel: () => void;
}

// Removing a take discards a recording, so it asks once, under the row, with the take named.
const RemoveConfirm = ({ index, onConfirm, onCancel }: RemoveConfirmProps) => {
  const { t } = useTranslation('builder');

  return (
    <div
      role="alertdialog"
      aria-label={t('rush.confirmRemove', { number: index + 1 })}
      className="animate-field-in flex flex-wrap items-center justify-between gap-2 rounded-lg bg-foreground/[0.06] px-3 py-2 text-xs text-foreground motion-reduce:animate-none"
    >
      <span>{t('rush.confirmRemove', { number: index + 1 })}</span>
      <span className="flex gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-9 rounded-md px-3 font-medium text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
        >
          {t('rush.keep')}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="min-h-9 rounded-md bg-[var(--color-error)] px-3 font-semibold text-white hover:bg-[var(--color-error)]/90"
        >
          {t('rush.confirm')}
        </button>
      </span>
    </div>
  );
};

interface RushChooserProps {
  rushes: File[];
  selectedRush: File | undefined;
  onSelectRush: (file: File) => void;
  onRemoveRush: (file: File) => void;
  orientation?: TemplateOrientation;
}

// The take gallery: a horizontal row of the section's recorded/uploaded takes. Shown as soon as there
// is one take, so a single recording still has a visible thumbnail to confirm/remove; with several,
// it's the chooser for the keeper. Hidden only when there are no takes.
export const RushChooser = ({
  rushes,
  selectedRush,
  onSelectRush,
  onRemoveRush,
  orientation = 'portrait',
}: RushChooserProps) => {
  const { t } = useTranslation('builder');
  // A stable key per File so React keeps each thumb's video element across reorders/removals.
  const [keys] = useState(() => new WeakMap<File, string>());
  const [confirming, setConfirming] = useState<File | null>(null);
  const keyFor = (file: File, i: number): string => {
    const existing = keys.get(file);

    if (existing) return existing;

    const next = `${i}-${file.name}-${file.lastModified}`;
    keys.set(file, next);

    return next;
  };

  if (rushes.length === 0) return null;

  const confirmIndex = confirming ? rushes.indexOf(confirming) : -1;

  return (
    <section aria-label={t('rush.gallery')} className="space-y-2">
      <h4 className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {t('rush.gallery')}
      </h4>
      {/* Padding on every side keeps the selection ring and the focus rings inside the scroll box. */}
      <div
        role="radiogroup"
        aria-label={t('rush.gallery')}
        className="flex items-start gap-3 overflow-x-auto p-1 [scrollbar-width:thin]"
      >
        {rushes.map((file, i) => (
          <RushThumb
            key={keyFor(file, i)}
            file={file}
            index={i}
            selected={file === selectedRush}
            shape={THUMB_SHAPE[orientation]}
            onSelect={() => {
              onSelectRush(file);
            }}
            onRemove={() => {
              setConfirming(file);
            }}
          />
        ))}
      </div>
      {confirming && confirmIndex >= 0 ? (
        <RemoveConfirm
          index={confirmIndex}
          onCancel={() => {
            setConfirming(null);
          }}
          onConfirm={() => {
            onRemoveRush(confirming);
            setConfirming(null);
          }}
        />
      ) : null}
    </section>
  );
};
