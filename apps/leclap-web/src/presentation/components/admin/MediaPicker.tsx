import { useState, useId, useRef, useEffect } from 'react';
import { useMediaDrop, type AcceptSpec } from '@/lib/upload';
import { describeAccept } from '@/lib/upload/core/describe-accept';
import type { Rejection } from '@/lib/upload/core/types';
import { rejectionMessages } from './media-picker-rejections';
import { useTranslation } from 'react-i18next';
import { Upload, Music, Image as ImageIcon, Video as VideoIcon, Check, X } from '@/presentation/components/icons';
import { PlayIcon } from '@/presentation/components/icons/play';
import { PauseIcon } from '@/presentation/components/icons/pause';
import { useIconHover } from '@/presentation/components/icons/useIconHover';
import { cn } from '@/lib/utils';
import { coverGradient } from '@/lib/poster';
import { Button, SegmentedControl } from '@/presentation/components/ui';
import { browserMediaService } from '@/services/browserMediaService';
import { MUSIC_LIBRARY, BACKGROUND_LIBRARY, type MediaCredit } from '@/data/mediaCatalog';
import type { MediaChoice } from './templateEditorModel';
import { CANVAS_DND_MIME, type DropPayload } from './editor-shell/canvasDrop';

type MediaKind = 'music' | 'picture' | 'video';
type Tab = 'library' | 'upload' | 'url';

export interface MediaPickerProps {
  kind: MediaKind;
  // single-select (existing + Builder):
  value?: MediaChoice | null;
  onChange?: (choice: MediaChoice | null) => void;
  // multi-select (template editor shortlist):
  multiple?: boolean;
  selectedIds?: string[];
  onToggleId?: (id: string) => void;
  // single-select-by-id (one library item, radio semantics): picking the active item clears it.
  selectedId?: string | null;
  onSelectId?: (id: string | null) => void;
  // restrict the library grid to these ids
  allowedIds?: string[];
  // hide the Upload tab when uploads aren't allowed (default: shown)
  allowUpload?: boolean;
}

interface CardProps {
  item: MediaCredit;
  selected: boolean;
  onPick: () => void;
}

// Wildcard groups: the extensions are for validation and copy only. They must never reach the
// <input accept> attribute, or iOS/Android stop offering Camera and Photo Library.
const ACCEPT: Record<MediaKind, AcceptSpec> = {
  music: [{ mime: 'audio/*', extensions: ['.mp3', '.wav', '.m4a', '.aac', '.ogg'] }],
  picture: [{ mime: 'image/*', extensions: ['.jpg', '.jpeg', '.png', '.webp'] }],
  video: [{ mime: 'video/*', extensions: ['.mp4', '.mov', '.webm', '.m4v'] }],
};

// Per-kind copy + glyph for the upload pane / selected-upload chip / empty state.
const KIND_ICON: Record<MediaKind, typeof Music> = { music: Music, picture: ImageIcon, video: VideoIcon };
const UPLOAD_LABEL_KEY: Record<MediaKind, string> = {
  music: 'media.uploadMusic',
  picture: 'media.uploadImage',
  video: 'media.uploadVideo',
};
const DROP_KEY: Record<MediaKind, string> = {
  music: 'media.dropTrack',
  picture: 'media.dropImage',
  video: 'media.dropVideo',
};
const FORMATS_KEY: Record<MediaKind, string> = {
  music: 'media.musicFormats',
  picture: 'media.imageFormats',
  video: 'media.videoFormats',
};

function filterByAllowed(items: MediaCredit[], allowedIds: string[] | undefined): MediaCredit[] {
  if (!allowedIds) return items;

  return items.filter((i) => allowedIds.includes(i.id));
}

const noop = () => {};
const pickerShellClass = '@container rounded-xl border border-foreground/10 bg-surface-2/40 p-3';
// Columns follow the picker's own width, not the viewport's: in the ~20rem editor panel a viewport
// breakpoint gave three ~85px tiles, truncating every title under a play button that covered the art.
const libraryGridClass = 'grid grid-cols-2 gap-2 @md:grid-cols-3';

function initialTab(kind: MediaKind, multiple: boolean | undefined, value: MediaChoice | null | undefined): Tab {
  if (multiple) return 'library';

  if (value?.source === 'upload') return 'upload';

  if (value?.source === 'url') return 'url';

  return kind === 'video' ? 'upload' : 'library';
}

interface PickerContentProps extends MediaPickerProps {
  tab: Tab;
  setTab: (tab: Tab) => void;
}

function TabPickerContent({ kind, value, onChange, allowedIds, allowUpload, tab, setTab }: PickerContentProps) {
  const choice = value ?? null;
  const handleChange = onChange ?? noop;

  return (
    <>
      <TabSwitch kind={kind} tab={tab} setTab={setTab} allowUpload={allowUpload ?? true} />
      {tab === 'library' ? (
        <SingleLibraryGrid kind={kind} value={choice} onChange={handleChange} allowedIds={allowedIds} />
      ) : null}
      {tab === 'upload' ? <UploadPane kind={kind} value={choice} onChange={handleChange} /> : null}
      {tab === 'url' ? <UrlPane value={choice} onChange={handleChange} /> : null}
    </>
  );
}

function PickerContent({
  kind,
  value,
  onChange,
  multiple,
  selectedIds,
  onToggleId,
  selectedId,
  onSelectId,
  allowedIds,
  allowUpload = true,
  tab,
  setTab,
}: PickerContentProps) {
  if (multiple) {
    return (
      <MultiLibraryGrid
        kind={kind}
        selectedIds={selectedIds ?? []}
        onToggleId={onToggleId ?? noop}
        allowedIds={allowedIds}
      />
    );
  }

  if (onSelectId) {
    return (
      <SingleByIdGrid kind={kind} selectedId={selectedId ?? null} onSelectId={onSelectId} allowedIds={allowedIds} />
    );
  }

  return (
    <TabPickerContent
      kind={kind}
      value={value}
      onChange={onChange}
      allowedIds={allowedIds}
      allowUpload={allowUpload}
      tab={tab}
      setTab={setTab}
    />
  );
}

// On-brand empty state for a library grid: a compact dashed brand panel with the kind's glyph, instead
// of a bare line of grey text. Static (no motion), so it's reduced-motion safe by construction.
const MediaEmpty = ({ kind, message }: { kind: MediaKind; message: string }) => {
  const Icon = KIND_ICON[kind];

  return (
    <div className="flex flex-col items-center gap-2.5 rounded-lg border border-dashed border-brand-500/25 bg-brand-500/[0.04] px-4 py-8 text-center">
      <span className="grid size-9 place-items-center rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-300">
        <Icon className="size-4" />
      </span>
      <p className="text-sm text-gray-400">{message}</p>
    </div>
  );
};

export const MediaPicker = ({
  kind,
  value,
  onChange,
  multiple,
  selectedIds,
  onToggleId,
  selectedId,
  onSelectId,
  allowedIds,
  allowUpload = true,
}: MediaPickerProps) => {
  // Open on the tab matching the current single-select choice (so re-opening a URL/upload choice
  // lands you back where you set it); the multi-select editor only has the library grid.
  const [tab, setTab] = useState<Tab>(() => initialTab(kind, multiple, value));

  return (
    <div className={pickerShellClass}>
      <PickerContent
        kind={kind}
        value={value}
        onChange={onChange}
        multiple={multiple}
        selectedIds={selectedIds}
        onToggleId={onToggleId}
        selectedId={selectedId}
        onSelectId={onSelectId}
        allowedIds={allowedIds}
        allowUpload={allowUpload}
        tab={tab}
        setTab={setTab}
      />
    </div>
  );
};

// The tab set per kind: video has no curated library, so only Upload / URL are offered.
const tabsFor = (kind: MediaKind, allowUpload: boolean): Tab[] => {
  if (kind === 'video') return ['upload', 'url'];

  if (allowUpload) return ['library', 'upload', 'url'];

  return ['library', 'url'];
};

const TabSwitch = ({
  kind,
  tab,
  setTab,
  allowUpload,
}: {
  kind: MediaKind;
  tab: Tab;
  setTab: (t: Tab) => void;
  allowUpload: boolean;
}) => {
  const { t } = useTranslation('admin');
  const tabs = tabsFor(kind, allowUpload);

  return (
    <SegmentedControl
      ariaLabel={t('media.source')}
      value={tab}
      onChange={(value) => {
        setTab(value as Tab);
      }}
      options={tabs.map((tabId) => ({ value: tabId, label: t(`media.tab.${tabId}`) }))}
      classNames={{ track: 'mb-3', button: 'capitalize' }}
    />
  );
};

interface SingleLibraryGridProps {
  kind: MediaKind;
  value: MediaChoice | null;
  onChange: (choice: MediaChoice | null) => void;
  allowedIds?: string[];
}

const SingleLibraryGrid = ({ kind, value, onChange, allowedIds }: SingleLibraryGridProps) => {
  const { t } = useTranslation('admin');
  const rawItems = kind === 'music' ? MUSIC_LIBRARY : BACKGROUND_LIBRARY;
  const items = filterByAllowed(rawItems, allowedIds);

  if (items.length === 0) {
    return <MediaEmpty kind={kind} message={t('media.emptyLibrary')} />;
  }

  return (
    <div className={libraryGridClass}>
      {items.map((item) => {
        const selected = value?.source === 'library' && value.id === item.id;
        const pick = () => {
          onChange({ source: 'library', id: item.id });
        };

        if (kind === 'music') {
          return <MusicCard key={item.id} item={item} selected={selected} onPick={pick} />;
        }

        return <PictureCard key={item.id} item={item} selected={selected} onPick={pick} />;
      })}
    </div>
  );
};

interface MultiLibraryGridProps {
  kind: MediaKind;
  selectedIds: string[];
  onToggleId: (id: string) => void;
  allowedIds?: string[];
}

const MultiLibraryGrid = ({ kind, selectedIds, onToggleId, allowedIds }: MultiLibraryGridProps) => {
  const { t } = useTranslation('admin');
  const rawItems = kind === 'music' ? MUSIC_LIBRARY : BACKGROUND_LIBRARY;
  const items = filterByAllowed(rawItems, allowedIds);

  if (items.length === 0) {
    return <MediaEmpty kind={kind} message={t('media.emptyMultiLibrary')} />;
  }

  return (
    <div className={libraryGridClass}>
      {items.map((item) => {
        const selected = selectedIds.includes(item.id);
        const toggle = () => {
          onToggleId(item.id);
        };

        if (kind === 'music') {
          return <MusicCard key={item.id} item={item} selected={selected} onPick={toggle} />;
        }

        return <PictureCard key={item.id} item={item} selected={selected} onPick={toggle} />;
      })}
    </div>
  );
};

interface SingleByIdGridProps {
  kind: MediaKind;
  selectedId: string | null;
  onSelectId: (id: string | null) => void;
  allowedIds?: string[];
}

// Radio-style library grid: picking an item replaces the current choice, picking the active item clears it.
const SingleByIdGrid = ({ kind, selectedId, onSelectId, allowedIds }: SingleByIdGridProps) => {
  const { t } = useTranslation('admin');
  const rawItems = kind === 'music' ? MUSIC_LIBRARY : BACKGROUND_LIBRARY;
  const items = filterByAllowed(rawItems, allowedIds);

  if (items.length === 0) {
    return <MediaEmpty kind={kind} message={t('media.emptyLibrary')} />;
  }

  return (
    <div role="radiogroup" className={libraryGridClass}>
      {items.map((item) => {
        const selected = selectedId === item.id;
        const pick = () => {
          onSelectId(selected ? null : item.id);
        };

        if (kind === 'music') {
          return <MusicCard key={item.id} item={item} selected={selected} onPick={pick} />;
        }

        return <PictureCard key={item.id} item={item} selected={selected} onPick={pick} />;
      })}
    </div>
  );
};

// Only one preview plays at a time across the whole picker: starting a track pauses whichever element
// was playing. The state of each card is driven by its <audio> play/pause events, so a track stopped
// from another card flips its own button back automatically.
let activePreview: HTMLAudioElement | null = null;

const MusicCard = ({ item, selected, onPick }: CardProps) => {
  const { t } = useTranslation('admin');
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const { ref: playRef, hoverProps: playHoverProps } = useIconHover();
  const { ref: pauseRef, hoverProps: pauseHoverProps } = useIconHover();

  // Release the shared slot if this card owned it when it unmounts (e.g. switching the Library tab).
  useEffect(
    () => () => {
      const audio = audioRef.current;

      if (audio && activePreview === audio) activePreview = null;
    },
    []
  );

  const toggle = () => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    if (!audio.paused) {
      audio.pause();

      return;
    }

    if (activePreview && activePreview !== audio) activePreview.pause();

    activePreview = audio;
    audio.play().catch(() => {});
  };

  return (
    <div
      className={cn(
        'relative rounded-xl border p-2 transition-all',
        selected
          ? 'border-brand-500 bg-brand-500/5 ring-2 ring-brand-500/30'
          : 'border-foreground/10 hover:border-brand-500/40'
      )}
    >
      <button type="button" onClick={onPick} aria-pressed={selected} className="block w-full text-left">
        <span
          className="relative block aspect-square w-full overflow-hidden rounded-lg"
          style={item.cover ? undefined : { backgroundImage: coverGradient(item.id) }}
        >
          {item.cover ? (
            <img src={item.cover} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <Music className="absolute inset-0 m-auto h-8 w-8 text-white/85" />
          )}
          {selected ? (
            <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-brand-500">
              <Check className="h-3 w-3 text-white" />
            </span>
          ) : null}
        </span>
        <span className="mt-2 block truncate text-sm font-semibold text-foreground">{item.title}</span>
        <span className="block truncate text-xs text-gray-400">{item.author}</span>
      </button>
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? t('media.pause', { title: item.title }) : t('media.play', { title: item.title })}
        className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-full bg-black/55 text-white backdrop-blur transition hover:scale-105 hover:bg-brand-600"
        {...(playing ? pauseHoverProps : playHoverProps)}
      >
        {playing ? (
          <PauseIcon ref={pauseRef} size={16} />
        ) : (
          <PlayIcon ref={playRef} size={16} className="translate-x-px" />
        )}
      </button>
      <audio
        ref={audioRef}
        src={item.url}
        preload="none"
        onPlay={() => {
          setPlaying(true);
        }}
        onPause={() => {
          setPlaying(false);
        }}
        onEnded={() => {
          setPlaying(false);

          if (activePreview === audioRef.current) activePreview = null;
        }}
        className="sr-only"
      />
    </div>
  );
};

// A library picture card is draggable onto the section canvas (its id resolves to a library choice).
// Music cards are never droppable, so only PictureCard carries the drag payload.
const picturePayload = (id: string): DropPayload => ({
  source: 'library',
  element: 'image',
  choice: { source: 'library', id },
});

const PictureCard = ({ item, selected, onPick }: CardProps) => (
  <button
    type="button"
    draggable
    onDragStart={(event) => {
      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setData(CANVAS_DND_MIME, JSON.stringify(picturePayload(item.id)));
    }}
    onClick={onPick}
    aria-pressed={selected}
    className={cn(
      'group relative block overflow-hidden rounded-xl border text-left transition-all',
      selected ? 'border-brand-500 ring-2 ring-brand-500/30' : 'border-foreground/10 hover:border-brand-500/40'
    )}
  >
    <span className="block aspect-video w-full overflow-hidden">
      <img
        src={item.url}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover transition-transform group-hover:scale-105"
      />
    </span>
    <span className="block px-2 py-1.5">
      <span className="block truncate text-xs font-semibold text-foreground">{item.title}</span>
      <span className="block truncate text-[0.65rem] text-gray-400">
        {item.author} · {item.license}
      </span>
    </span>
    {selected ? <Check className="absolute right-2 top-2 h-4 w-4 rounded-full bg-brand-500 p-0.5 text-white" /> : null}
  </button>
);

interface UploadPaneProps {
  kind: MediaKind;
  value: MediaChoice | null;
  onChange: (choice: MediaChoice | null) => void;
}

const UploadPane = ({ kind, value, onChange }: UploadPaneProps) => {
  const { t } = useTranslation('admin');
  const inputId = useId();
  const [errors, setErrors] = useState<string[]>([]);
  // Which drop the current messages belong to. `role="alert"` announces on mount and on a text
  // change beneath it — so a second drop yielding byte-identical messages reconciles the same list
  // items with the same text, mutates nothing, and is announced not at all. Keying the items by
  // attempt remounts them even when the words are the same, which is the case that matters: the
  // screen-reader user who retries and needs to hear that the retry was rejected too.
  const [attempt, setAttempt] = useState(0);
  const formats = describeAccept(ACCEPT[kind]);

  const onDrop = (files: File[], rejections: Rejection[]) => {
    setAttempt((n) => n + 1);
    setErrors(rejectionMessages(rejections, t, formats));

    if (files.length === 0) {
      return;
    }

    const file = files[0];
    // Two-callback `.then`, not a trailing `.catch`: a `.catch` chained after `onChange` would also
    // catch a throw from `onChange` itself and blame it on storage, telling the user to clear their
    // browser data over a file that was in fact saved.
    browserMediaService.save(file, kind).then(
      ({ key }) => {
        onChange({ source: 'upload', key, label: file.name });
      },
      (error: unknown) => {
        // A storage failure used to be swallowed here, so a full quota looked exactly like nothing
        // happening. Surface it in the same place as a rejection — appended, not substituted, so the
        // rejection lines this same drop produced a moment ago survive. The real error still goes to
        // the console: quota, an IndexedDB abort and a coding bug read identically to the user.
        console.error('Saving dropped media failed', error);
        setErrors((previous) => [...previous, t('media.rejectSaveFailed', { name: file.name })]);
      }
    );
  };

  const { getRootProps, getInputProps, isDragActive } = useMediaDrop({
    onDrop,
    accept: ACCEPT[kind],
    remaining: 1,
    multiple: false,
  });

  // A rejection reported by one drop (e.g. the surplus file in a two-file drop) is unrelated to
  // whatever this pane currently holds, so the two branches below share one errors block instead of
  // each owning their own — the alert used to live only in the dropzone branch and unmounted the
  // instant `onChange` fired from underneath it (the accepted file's save resolves in milliseconds),
  // hiding a message the user had no real chance to read.
  return (
    <>
      {value?.source === 'upload' ? (
        <SelectedUpload
          kind={kind}
          label={value.label}
          onClear={() => {
            // Clearing the selection also clears any leftover rejection from the drop that produced
            // it — otherwise a stale message from a previous attempt reappears on the empty dropzone.
            setErrors([]);
            onChange(null);
          }}
        />
      ) : (
        <div
          {...getRootProps()}
          aria-label={t(UPLOAD_LABEL_KEY[kind])}
          className={cn(
            'flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors',
            isDragActive ? 'border-brand-500 bg-brand-500/10' : 'border-foreground/15 hover:border-brand-500/50'
          )}
        >
          <input {...getInputProps()} id={inputId} aria-label={t(UPLOAD_LABEL_KEY[kind])} />
          <Upload className="h-6 w-6 text-gray-400" />
          <span className="text-sm text-gray-300">{t(DROP_KEY[kind])}</span>
          <span className="text-xs text-gray-500">{t(FORMATS_KEY[kind], { formats })}</span>
        </div>
      )}
      {errors.length > 0 ? (
        <div className="mt-3 rounded-lg bg-[var(--color-error)]/8 px-3 py-2">
          {/* `role="alert"` sits on the list, not on the wrapper: everything inside the alert is read
              out on every announcement, so a Dismiss button in there makes each rejection end with
              "Dismiss, button" — a control announced as part of the message it dismisses. */}
          <ul role="alert" className="space-y-1 text-xs leading-5 text-[var(--color-error)]">
            {errors.map((message, index) => (
              <li key={`${attempt}-${index}`}>{message}</li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              setErrors([]);
            }}
            className="mt-1.5 text-[0.7rem] font-semibold uppercase tracking-wider text-[var(--color-error)]/80 hover:text-[var(--color-error)]"
          >
            {t('media.rejectDismiss')}
          </button>
        </div>
      ) : null}
    </>
  );
};

// Paste a direct asset URL (image/audio hosted elsewhere). The engine fetches it at compile time,
// so no copy is stored on device — distinct from Upload. Clearing the field drops the choice.
const UrlPane = ({
  value,
  onChange,
}: {
  value: MediaChoice | null;
  onChange: (choice: MediaChoice | null) => void;
}) => {
  const { t } = useTranslation('admin');
  const inputId = useId();
  const url = value?.source === 'url' ? value.url : '';

  return (
    <div>
      <label htmlFor={inputId} className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-gray-400">
        {t('media.urlLabel')}
      </label>
      <input
        id={inputId}
        type="url"
        inputMode="url"
        value={url}
        placeholder={t('media.urlPlaceholder')}
        onChange={(e) => {
          const next = e.target.value.trim();
          onChange(next === '' ? null : { source: 'url', url: next });
        }}
        className="field-focus-gradient w-full rounded-lg border border-foreground/10 bg-surface px-3 py-2 text-sm text-foreground placeholder:text-gray-500 transition-colors [--field-fill:var(--color-surface)] focus:outline-none"
      />
      <span className="mt-1 block text-xs text-gray-500">{t('media.urlHint')}</span>
    </div>
  );
};

const SelectedUpload = ({ kind, label, onClear }: { kind: MediaKind; label: string; onClear: () => void }) => {
  const { t } = useTranslation('admin');
  const Icon = KIND_ICON[kind];

  return (
    <div className="flex items-center gap-3 rounded-lg border border-brand-500/30 bg-brand-500/10 p-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-500/20 text-brand-300">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{label}</span>
        <span className="block text-xs text-gray-400">{t('media.uploaded')}</span>
      </span>
      <Button
        variant="ghost"
        size="icon"
        onClick={onClear}
        aria-label={t('media.removeUpload')}
        className="text-gray-400"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
};
