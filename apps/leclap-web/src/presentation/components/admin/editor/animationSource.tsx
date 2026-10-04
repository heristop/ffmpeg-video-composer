// Canvas-free animation overlay pieces shared by AnimationGallery (which adds the drag canvas) and the
// canvas-less PlacementControls inspector: AnimationSource = the Library / Upload / Url tabbed source picker,
// and AnimationPlayback = playback extent (forever / loops / seconds) + start offset + keep-last-frame.
// These are the single source for the animation source/playback UI so both consumers reuse them.
import { useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMediaDrop, type AcceptSpec, type Rejection } from '@/lib/upload';
import { Upload, X, Check } from '@/presentation/components/icons';
import { cn } from '@/lib/utils';
import { Button, Checkbox, SegmentedControl } from '@/presentation/components/ui';
import { NumberField } from '@/presentation/components/ui/NumberField';
import { ANIMATION_LIBRARY, findAnimationByUrl, type AnimationAsset } from '@/data/mediaCatalog';
import { animationDefaultsForUrl, type AnimationOverlay } from '../templateEditorModel';
import { PREVIEW_BG_CLASS } from './animationOverlay';
import { AnimationMedia } from './AnimationMedia';
import { CANVAS_DND_MIME, type DropPayload } from '../editor-shell/canvasDrop';

// Begin a native drag carrying a serialized drop payload (so the card can be dropped on the canvas).
const startCanvasDrag = (event: DragEvent, payload: DropPayload) => {
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData(CANVAS_DND_MIME, JSON.stringify(payload));
};

type Tab = 'library' | 'upload' | 'url';

// Both concrete types (no wildcard), so the picker advertises the extensions alongside them.
const ANIMATION_ACCEPT: AcceptSpec = [
  { mime: 'image/apng', extensions: ['.apng'] },
  { mime: 'video/webm', extensions: ['.webm'] },
];

// Library cards + upload preview sit on the transparency checker so transparent/white overlays stay
// readable; the placement panel below (when present) carries its own switchable backdrop.
export const CHECKER = PREVIEW_BG_CLASS.checker;

// Open on the tab matching the current value so re-opening lands you back where you set it: a library
// match → Library, a data: URL → Upload, an http(s) URL not in the library → Url.
export const pickInitialTab = (value: AnimationOverlay | undefined): Tab => {
  if (!value) return 'library';

  if (findAnimationByUrl(value.url)) return 'library';

  if (value.url.startsWith('data:')) return 'upload';

  if (/^https?:/i.test(value.url)) return 'url';

  return 'library';
};

interface AnimationSourceProps {
  value: AnimationOverlay | undefined;
  onChange: (value?: AnimationOverlay) => void;
  /** Override the dynamic library with a curated list (config-driven); defaults to all bundled animations. */
  library?: AnimationAsset[];
}

// The Library / Upload / Url tabbed source picker (no canvas, no placement).
export const AnimationSource = ({ value, onChange, library = ANIMATION_LIBRARY }: AnimationSourceProps) => {
  const [tab, setTab] = useState<Tab>(() => pickInitialTab(value));

  return (
    <div>
      <AnimationTabs tab={tab} setTab={setTab} />
      {tab === 'library' ? <AnimationLibraryGrid value={value} library={library} onChange={onChange} /> : null}
      {tab === 'upload' ? <AnimationUploadPane value={value} onChange={onChange} /> : null}
      {tab === 'url' ? <AnimationUrlPane value={value} onChange={onChange} /> : null}
    </div>
  );
};

type PlaybackMode = 'forever' | 'loops' | 'seconds';

// Derive the active mode from which extent field is set; loop:false (play once) reads as a 1-loop count.
const playbackModeOf = (v: AnimationOverlay): PlaybackMode => {
  if (v.duration !== undefined) return 'seconds';

  if (v.loops !== undefined || v.loop === false) return 'loops';

  return 'forever';
};

interface PlaybackProps {
  value: AnimationOverlay;
  patch: (over: Partial<AnimationOverlay>) => void;
}

// Playback extent + start offset + keep-last-frame. The 3-way control sets exactly one extent (clearing the
// others) so the descriptor stays unambiguous; "Start" delays the overlay (0 = from the beginning).
export const AnimationPlayback = ({ value, patch }: PlaybackProps) => {
  const { t } = useTranslation('admin');
  const mode = playbackModeOf(value);

  const setMode = (next: PlaybackMode) => {
    if (next === 'forever') patch({ loop: true, loops: undefined, duration: undefined });

    if (next === 'loops') patch({ loops: value.loops ?? 1, loop: undefined, duration: undefined });

    if (next === 'seconds') patch({ duration: value.duration ?? 3, loop: undefined, loops: undefined });
  };

  return (
    <div className="space-y-2 pt-0.5">
      <SegmentedControl
        ariaLabel={t('animation.playback')}
        value={mode}
        onChange={(next) => {
          setMode(next as PlaybackMode);
        }}
        options={[
          { value: 'forever', label: t('animation.forever') },
          { value: 'loops', label: t('animation.loopsTab') },
          { value: 'seconds', label: t('animation.secondsTab') },
        ]}
      />
      {mode === 'loops' ? (
        <NumberRow
          label={t('animation.loopsLabel')}
          value={value.loops ?? 1}
          min={1}
          onChange={(n) => {
            patch({ loops: Math.max(1, Math.round(n)) });
          }}
        />
      ) : null}
      {mode === 'seconds' ? (
        <NumberRow
          label={t('animation.secondsLabel', { count: value.duration ?? 3 })}
          value={value.duration ?? 3}
          min={0.1}
          step={0.5}
          unit="s"
          onChange={(n) => {
            patch({ duration: n });
          }}
        />
      ) : null}
      <NumberRow
        label={t('animation.startLabel')}
        value={value.start ?? 0}
        min={0}
        step={0.5}
        unit="s"
        onChange={(n) => {
          patch({ start: n > 0 ? n : undefined });
        }}
      />
      <label className="flex w-fit cursor-pointer select-none items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
        <Checkbox
          checked={value.persistent ?? true}
          onCheckedChange={(c) => {
            patch({ persistent: c === true });
          }}
        />
        {t('animation.keepLastFrame')}
      </label>
    </div>
  );
};

// Shared label + compact number input row; also reused by ImageOverlayField for the image show window.
export const NumberRow = ({
  label,
  value,
  min,
  step = 1,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
}) => (
  <div className="flex items-center justify-between gap-2">
    <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">{label}</span>
    <NumberField
      aria-label={label}
      value={value}
      min={min}
      step={step}
      unit={unit}
      compact
      className="w-28"
      onChange={onChange}
    />
  </div>
);

const AnimationTabs = ({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) => {
  const { t } = useTranslation('admin');
  const tabs: Tab[] = ['library', 'upload', 'url'];

  return (
    <SegmentedControl
      ariaLabel={t('media.source')}
      value={tab}
      onChange={(next) => {
        setTab(next as Tab);
      }}
      options={tabs.map((tabId) => ({ value: tabId, label: t(`media.tab.${tabId}`) }))}
      classNames={{ track: 'mb-3', button: 'capitalize' }}
    />
  );
};

interface LibraryGridProps {
  value: AnimationOverlay | undefined;
  library: AnimationAsset[];
  onChange: (value?: AnimationOverlay) => void;
}

const AnimationLibraryGrid = ({ value, library, onChange }: LibraryGridProps) => (
  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup">
    {library.map((animation) => {
      const selected = value?.url === animation.url;

      return (
        <button
          key={animation.id}
          type="button"
          role="radio"
          aria-checked={selected}
          draggable
          onDragStart={(event) => {
            startCanvasDrag(event, {
              source: 'library',
              element: 'animation',
              url: animation.url,
              label: animation.label,
            });
          }}
          onClick={() => {
            onChange({ url: animation.url, label: animation.label, ...animationDefaultsForUrl(animation.url) });
          }}
          className={cn(
            'group relative block overflow-hidden rounded-xl border text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
            selected ? 'border-brand-500 ring-2 ring-brand-500/30' : 'border-foreground/10 hover:border-brand-500/40'
          )}
        >
          <span className={cn('block aspect-video w-full overflow-hidden', CHECKER)}>
            <AnimationMedia url={animation.url} className="h-full w-full object-contain" />
          </span>
          <span className="block truncate px-2 py-1.5 text-[0.65rem] font-semibold text-foreground">
            {animation.label}
          </span>
          {selected ? (
            <Check className="absolute right-2 top-2 h-4 w-4 rounded-full bg-brand-500 p-0.5 text-white" />
          ) : null}
        </button>
      );
    })}
  </div>
);

interface PaneProps {
  value: AnimationOverlay | undefined;
  onChange: (value?: AnimationOverlay) => void;
}

const AnimationUploadPane = ({ value, onChange }: PaneProps) => {
  const { t } = useTranslation('admin');
  const [invalid, setInvalid] = useState(false);

  // ANIMATION_ACCEPT is the only type guard: useMediaDrop validates against it and hands the
  // failures back here, so a dropped .gif reports `animation.invalidType` instead of vanishing.
  const onDrop = (files: File[], rejections: Rejection[]) => {
    setInvalid(rejections.length > 0);

    if (files.length === 0) {
      return;
    }

    const file = files[0];
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onChange({ url: reader.result, label: file.name });
      }
    };
    reader.readAsDataURL(file);
  };

  const { getRootProps, getInputProps, isDragActive } = useMediaDrop({
    onDrop,
    accept: ANIMATION_ACCEPT,
    remaining: 1,
    multiple: false,
  });

  // A data: URL is an uploaded animation (library/url assets resolve elsewhere) — show its live preview.
  const uploaded = value?.url.startsWith('data:') ? value : undefined;

  if (uploaded) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-brand-500/30 bg-brand-500/10 p-3">
        <span className={cn('grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-lg', CHECKER)}>
          <AnimationMedia url={uploaded.url} className="h-full w-full object-contain" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{uploaded.label}</span>
          <span className="block text-xs text-gray-400">{t('animation.uploaded')}</span>
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            onChange();
          }}
          aria-label={t('animation.removeUpload')}
          className="text-gray-400"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div
        {...getRootProps()}
        aria-label={t('animation.upload')}
        className={cn(
          'flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors',
          isDragActive ? 'border-brand-500 bg-brand-500/10' : 'border-foreground/15 hover:border-brand-500/50'
        )}
      >
        <input {...getInputProps()} aria-label={t('animation.upload')} />
        <Upload className="h-6 w-6 text-gray-400" />
        <span className="text-sm text-gray-300">{t('animation.dropAnimation')}</span>
        <span className="text-xs text-gray-500">{t('animation.animationFormats')}</span>
      </div>
      {invalid ? <p className="mt-1 text-[0.7rem] text-red-500">{t('animation.invalidType')}</p> : null}
    </div>
  );
};

// Paste a direct animation URL (hosted elsewhere); the engine fetches it at compile time. Clearing the
// field drops the choice. The label is derived from the URL's filename.
const AnimationUrlPane = ({ value, onChange }: PaneProps) => {
  const { t } = useTranslation('admin');
  const url = value && !value.url.startsWith('data:') && !findAnimationByUrl(value.url) ? value.url : '';

  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-gray-400">
        {t('media.urlLabel')}
      </label>
      <input
        type="url"
        inputMode="url"
        value={url}
        placeholder={t('media.urlPlaceholder')}
        onChange={(e) => {
          const next = e.target.value.trim();

          if (next === '') {
            onChange();

            return;
          }

          onChange({ url: next, label: next.split('/').pop() ?? next });
        }}
        className="field-focus-gradient w-full rounded-lg border border-foreground/10 bg-surface px-3 py-2 text-sm text-foreground placeholder:text-gray-500 transition-colors [--field-fill:var(--color-surface)] focus:outline-none"
      />
      <span className="mt-1 block text-xs text-gray-500">{t('media.urlHint')}</span>
    </div>
  );
};
