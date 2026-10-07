// The "Animation files" side of the animation picker: a clip played as-is on top of the scene (APNG / WebM,
// or a GIF / WebP by URL), stored as a section animation overlay. Its header names the kind and the chosen
// file's format, then the Library (stock samples) / Upload / Url tabs pick the file.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMediaDrop, type AcceptSpec, type Rejection } from '@/lib/upload';
import { Upload, X } from '@/presentation/components/icons';
import { cn } from '@/lib/utils';
import { Button, SegmentedControl } from '@/presentation/components/ui';
import { findAnimationByUrl, findSampleCard, type AnimationAsset, type PickerCard } from '@/data/mediaCatalog';
import { animationDefaultsForUrl, type AnimationOverlay } from '../templateEditorModel';
import { PREVIEW_BG_CLASS, animationFormat } from './animationOverlay';
import { AnimationMedia } from './AnimationMedia';
import { SampleLibraryPicker } from './AnimationLibraryPicker';
import { FamilyHeader } from './animationKinds';

type Tab = 'library' | 'upload' | 'url';

// Both concrete types (no wildcard), so the picker advertises the extensions alongside them.
const ANIMATION_ACCEPT: AcceptSpec = [
  { mime: 'image/apng', extensions: ['.apng'] },
  { mime: 'video/webm', extensions: ['.webm'] },
];

// The upload preview sits on the transparency checker so a transparent/white overlay stays readable
// (library cards show the file on their own dark stage instead); the placement panel below (when present)
// carries its own switchable backdrop.
const CHECKER = PREVIEW_BG_CLASS.checker;

// Open on the tab matching the current value so re-opening lands you back where you set it: a library
// match → Library, a data: URL → Upload, an http(s) URL not in the library → Url.
export const pickInitialTab = (value: AnimationOverlay | undefined): Tab => {
  if (!value) return 'library';

  if (findAnimationByUrl(value.url)) return 'library';

  if (value.url.startsWith('data:')) return 'upload';

  if (/^https?:/i.test(value.url)) return 'url';

  return 'library';
};

// A curated asset list as sample cards (the bundled ones keep their thumbnails).
const curatedSamples = (library: AnimationAsset[]): PickerCard[] =>
  library.map(
    (asset) =>
      findSampleCard(asset.url) ?? {
        key: `sample:${asset.id}`,
        id: asset.id,
        group: 'samples',
        labelKey: `animation.library.${asset.id}`,
        fallbackLabel: asset.label,
        sample: asset,
      }
  );

interface PaneProps {
  value: AnimationOverlay | undefined;
  onChange: (value?: AnimationOverlay) => void;
}

interface AnimationFilesPaneProps extends PaneProps {
  /** Override the sample list with a curated one (config-driven); defaults to the bundled samples. */
  library?: AnimationAsset[];
  /** False under the kind switch, which already names the side. */
  titled?: boolean;
}

export const AnimationFilesPane = ({ value, onChange, library, titled }: AnimationFilesPaneProps) => {
  const [tab, setTab] = useState<Tab>(() => pickInitialTab(value));
  const format = value?.url ? animationFormat(value.url) : undefined;

  return (
    <div className="space-y-3">
      <FamilyHeader family="file" format={format} titled={titled} />
      <FileTabs tab={tab} setTab={setTab} />
      {tab === 'library' ? (
        <SampleLibraryPicker
          selectedUrl={value?.url}
          samples={library ? curatedSamples(library) : undefined}
          onPickSample={(card) => {
            const asset = card.sample;

            if (asset) onChange({ url: asset.url, label: asset.label, ...animationDefaultsForUrl(asset.url) });
          }}
        />
      ) : null}
      {tab === 'upload' ? <AnimationUploadPane value={value} onChange={onChange} /> : null}
      {tab === 'url' ? <AnimationUrlPane value={value} onChange={onChange} /> : null}
    </div>
  );
};

const FileTabs = ({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) => {
  const { t } = useTranslation('admin');
  const tabs: Tab[] = ['library', 'upload', 'url'];

  return (
    <SegmentedControl
      ariaLabel={t('animation.kind.file.source')}
      value={tab}
      onChange={(next) => {
        setTab(next as Tab);
      }}
      options={tabs.map((tabId) => ({ value: tabId, label: t(`media.tab.${tabId}`) }))}
      classNames={{ button: 'capitalize' }}
    />
  );
};

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
      <div className="flex items-center gap-3 rounded-lg border border-secondary-500/30 bg-secondary-500/10 p-3">
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
          isDragActive
            ? 'border-secondary-500 bg-secondary-500/10'
            : 'border-foreground/15 hover:border-secondary-500/50'
        )}
      >
        <input {...getInputProps()} aria-label={t('animation.upload')} />
        <Upload className="h-6 w-6 text-gray-400" />
        <span className="text-sm text-gray-600 dark:text-gray-300">{t('animation.dropAnimation')}</span>
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
        placeholder={t('animation.urlPlaceholder')}
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
