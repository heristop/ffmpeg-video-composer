// The template editor's music shortlist: a dense track list rather than a grid of covers. Each row is
// one tab stop (a role="checkbox" button stretched over the row); the arrows move between rows, Enter
// ticks, Space previews, D makes the track the default. The cover doubles as the preview button, so
// the art is never covered by a control, and titles wrap rather than truncate.
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, Loader2, Music } from '@/presentation/components/icons';
import { PlayIcon } from '@/presentation/components/icons/play';
import { PauseIcon } from '@/presentation/components/icons/pause';
import { CheckboxMark } from '@/presentation/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { coverGradient } from '@/lib/poster';
import { MUSIC_LIBRARY, findMusic, type MediaCredit } from '@/data/mediaCatalog';
import {
  formatTrackTime,
  playheadRatio,
  stopPreview,
  togglePreview,
  trackDuration,
  useMusicPreview,
  type PreviewState,
} from './music-preview';
import { moveIndex, trackKeyAction } from './music-track-list.logic';

// The library covers carry the title and artist in their lower third; the list already prints both,
// so the thumbnail crops to the illustration above that band.
export function TrackArt({ item, className }: { item: MediaCredit; className?: string }) {
  if (!item.cover) {
    return (
      <span
        className={cn('relative block overflow-hidden', className)}
        style={{ backgroundImage: coverGradient(item.id) }}
      >
        <Music className="absolute inset-0 m-auto size-1/2 text-white/85" />
      </span>
    );
  }

  return (
    <span className={cn('relative block overflow-hidden bg-surface-inset', className)}>
      <img
        src={item.cover}
        alt=""
        loading="lazy"
        decoding="async"
        className="absolute left-[-32%] top-[-5%] h-[164%] w-[164%] max-w-none object-cover"
      />
    </span>
  );
}

interface MusicTrackListProps {
  selectedIds: string[];
  allowUpload: boolean;
  onToggle: (id: string) => void;
  onMakeDefault: (id: string) => void;
  onClear: () => void;
}

function previewOf(preview: PreviewState, id: string): PreviewState | null {
  return preview.trackId === id ? preview : null;
}

function initialRow(selectedIds: string[]): number {
  const index = MUSIC_LIBRARY.findIndex((item) => item.id === selectedIds.at(0));

  return Math.max(index, 0);
}

export function MusicTrackList({ selectedIds, allowUpload, onToggle, onMakeDefault, onClear }: MusicTrackListProps) {
  const { t } = useTranslation('admin');
  const hintId = useId();
  const preview = useMusicPreview();
  const [activeRow, setActiveRow] = useState(() => initialRow(selectedIds));
  const rows = useRef(new Map<number, HTMLButtonElement>());
  const defaultId = selectedIds.at(0);
  const standIn = findMusic(defaultId ?? '') ?? MUSIC_LIBRARY.at(0);

  const focusRow = (index: number) => {
    setActiveRow(index);
    rows.current.get(index)?.focus();
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number, item: MediaCredit) => {
    const action = trackKeyAction(event.key);

    if (!action || event.altKey || event.metaKey || event.ctrlKey) return;

    // The studio binds Space (program play) and the arrows (scene switching) on window; inside the list
    // they belong to the list.
    event.preventDefault();
    event.stopPropagation();

    if (action === 'preview') {
      togglePreview(item);

      return;
    }

    if (action === 'stop') {
      stopPreview();

      return;
    }

    if (action === 'makeDefault') {
      if (selectedIds.includes(item.id)) onMakeDefault(item.id);

      return;
    }

    focusRow(moveIndex(action, index, MUSIC_LIBRARY.length));
  };

  return (
    <div className="space-y-2">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <p aria-live="polite" className="text-xs font-medium tabular-nums text-muted-foreground">
          {t('musicSection.count', { count: selectedIds.length, total: MUSIC_LIBRARY.length })}
        </p>
        {selectedIds.length > 0 ? (
          <button
            type="button"
            onClick={onClear}
            className="-mr-2 h-8 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            {t('musicSection.clear')}
          </button>
        ) : null}
      </div>

      {selectedIds.length === 0 && standIn ? (
        <p className="flex gap-2 rounded-md bg-foreground/[0.04] px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>{t(allowUpload ? 'musicSection.emptyUpload' : 'musicSection.empty', { title: standIn.title })}</span>
        </p>
      ) : null}

      <ul aria-label={t('musicSection.listLabel')} className="-mx-2 grid gap-px">
        {MUSIC_LIBRARY.map((item, index) => (
          <TrackRow
            key={item.id}
            item={item}
            selected={selectedIds.includes(item.id)}
            isDefault={item.id === defaultId}
            preview={previewOf(preview, item.id)}
            tabbable={index === activeRow}
            hintId={hintId}
            rowRef={(node) => {
              if (node) rows.current.set(index, node);
            }}
            onFocus={() => {
              setActiveRow(index);
            }}
            onKeyDown={(event) => {
              onRowKeyDown(event, index, item);
            }}
            onToggle={() => {
              onToggle(item.id);
            }}
            onMakeDefault={() => {
              onMakeDefault(item.id);
            }}
          />
        ))}
      </ul>

      <p id={hintId} className="sr-only">
        {t('musicSection.keysHint')}
      </p>
      <p
        aria-hidden="true"
        className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-[0.6875rem] text-muted-foreground [@media(hover:none)]:hidden"
      >
        <span>
          <Kbd>↑↓</Kbd> {t('musicSection.keyMove')}
        </span>
        <span>
          <Kbd>Enter</Kbd> {t('musicSection.keyTick')}
        </span>
        <span>
          <Kbd>Space</Kbd> {t('musicSection.keyPreview')}
        </span>
        <span>
          <Kbd>D</Kbd> {t('musicSection.keyDefault')}
        </span>
      </p>
    </div>
  );
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded-[0.25rem] border border-foreground/15 bg-surface-inset px-1 py-px font-sans text-[0.625rem] font-medium text-foreground/80">
      {children}
    </kbd>
  );
}

interface TrackRowProps {
  item: MediaCredit;
  selected: boolean;
  isDefault: boolean;
  preview: PreviewState | null;
  tabbable: boolean;
  hintId: string;
  rowRef: (node: HTMLButtonElement | null) => void;
  onFocus: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onToggle: () => void;
  onMakeDefault: () => void;
}

function TrackRow({
  item,
  selected,
  isDefault,
  preview,
  tabbable,
  hintId,
  rowRef,
  onFocus,
  onKeyDown,
  onToggle,
  onMakeDefault,
}: TrackRowProps) {
  const titleId = useId();
  const metaId = useId();
  const duration = trackDuration(preview, item.durationSec);

  return (
    <li
      data-music-track={item.id}
      data-selected={selected}
      className={cn(
        'group relative grid min-h-14 grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-x-3 rounded-lg py-1.5 pl-2 pr-2.5 transition-colors duration-150',
        selected ? 'bg-brand-500/[0.09] hover:bg-brand-500/[0.13]' : 'hover:bg-foreground/[0.04]'
      )}
    >
      {/* The row's one tab stop, stretched under the cover and the default control. */}
      <button
        ref={rowRef}
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-labelledby={titleId}
        aria-describedby={`${metaId} ${hintId}`}
        aria-keyshortcuts="Enter Space D"
        tabIndex={tabbable ? 0 : -1}
        onFocus={onFocus}
        onClick={onToggle}
        onKeyDown={onKeyDown}
        onKeyUp={(event) => {
          // Space is the preview key here; keep the button from also treating it as a click.
          if (event.key === ' ') event.preventDefault();
        }}
        className="absolute inset-0 rounded-lg"
      />
      <CheckboxMark checked={selected} className="pointer-events-none" />
      <PreviewCover item={item} status={preview?.status ?? 'idle'} />
      <span className="pointer-events-none min-w-0 py-0.5">
        <span id={titleId} className="block break-words text-sm font-medium leading-snug text-foreground">
          {item.title}
        </span>
        <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-xs leading-snug text-muted-foreground">
          <span id={metaId}>
            <TrackMeta item={item} preview={preview} duration={duration} />
          </span>
          {selected && !isDefault ? <MakeDefaultButton title={item.title} onMakeDefault={onMakeDefault} /> : null}
        </span>
      </span>
      {isDefault ? <DefaultChip /> : <span />}
      <RowPlayhead preview={preview} duration={duration} />
    </li>
  );
}

// The cover is the preview button: hidden glyph until hover (always shown on touch, or while sounding).
function PreviewCover({ item, status }: { item: MediaCredit; status: PreviewState['status'] }) {
  const { t } = useTranslation('admin');
  const sounding = status === 'playing' || status === 'loading';
  const glyphShown = sounding || status === 'error';

  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={() => {
        togglePreview(item);
      }}
      aria-pressed={sounding}
      aria-label={t(sounding ? 'musicSection.stopPreview' : 'musicSection.preview', { title: item.title })}
      title={t('musicSection.previewTooltip')}
      className="relative z-10 size-11 overflow-hidden rounded-md shadow-[0_0_0_1px_var(--color-divider)]"
    >
      <TrackArt item={item} className="size-full" />
      <span
        className={cn(
          'absolute inset-0 grid place-items-center bg-player-ink/55 text-player-fg transition-opacity duration-150',
          glyphShown
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100 [@media(hover:none)]:bg-player-ink/35 [@media(hover:none)]:opacity-100'
        )}
      >
        <PreviewGlyph status={status} />
      </span>
    </button>
  );
}

// A thin playhead along the row's foot while its track is the one previewing.
function RowPlayhead({ preview, duration }: { preview: PreviewState | null; duration: number }) {
  if (!preview || preview.status === 'error') return null;

  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-2 bottom-0 h-0.5 overflow-hidden rounded-full bg-foreground/10"
    >
      <span
        className="block h-full origin-left bg-brand-400"
        style={{ transform: `scaleX(${playheadRatio(preview, duration)})` }}
      />
    </span>
  );
}

export function PreviewGlyph({ status }: { status: PreviewState['status'] }) {
  if (status === 'loading') {
    return <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />;
  }

  if (status === 'playing') return <PauseIcon size={16} />;

  return <PlayIcon size={16} className="translate-x-px" />;
}

function TrackMeta({ item, preview, duration }: { item: MediaCredit; preview: PreviewState | null; duration: number }) {
  const { t } = useTranslation('admin');

  if (preview?.status === 'error') {
    return <span className="text-[var(--color-error)]">{t('musicSection.previewError')}</span>;
  }

  if (preview) {
    return (
      <span className="tabular-nums text-brand-300">
        {formatTrackTime(preview.currentTime)} / {formatTrackTime(duration)}
      </span>
    );
  }

  return (
    <>
      <span className="break-words">{item.author}</span>
      {duration > 0 ? <span className="tabular-nums"> · {formatTrackTime(duration)}</span> : null}
    </>
  );
}

function DefaultChip() {
  const { t } = useTranslation('admin');

  return (
    <span
      title={t('musicSection.defaultTooltip')}
      className="relative z-10 rounded-[0.3125rem] bg-brand-500/20 px-1.5 py-0.5 text-[0.6875rem] font-medium text-brand-200"
    >
      {t('musicSection.default')}
    </span>
  );
}

// Lives in the meta line, so showing it on hover never reflows the title.
function MakeDefaultButton({ title, onMakeDefault }: { title: string; onMakeDefault: () => void }) {
  const { t } = useTranslation('admin');

  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={onMakeDefault}
      aria-label={t('musicSection.makeDefaultLabel', { title })}
      title={t('musicSection.makeDefaultTooltip')}
      className="pointer-events-auto relative z-10 font-medium text-brand-300 underline-offset-2 opacity-0 transition-opacity duration-150 hover:underline group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
    >
      {t('musicSection.makeDefault')}
    </button>
  );
}
