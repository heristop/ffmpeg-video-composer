// The sound-effects list for a section's `sfx` or the whole video's `global.sfx`: each cue's sound, its time
// (seconds or a time reference), its volume (0..200%, the sound's own level until set) and a preview. Composed
// sounds (`sound`) keep their synthesis: only their time and volume are editable here.
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SFX_ITEMS } from '@leclap/creative-kit/sfx';
import { Play, Plus, RotateCcw, X } from '@/presentation/components/icons';
import { cn } from '@/lib/utils';
import { rangeFill } from './controls';
import { EDITOR_INPUT_CLASS } from './editorStyles';
import {
  addCue,
  cueDefaultVolume,
  cueLibraryId,
  formatCueTime,
  parseCueTime,
  percentToVolume,
  removeCue,
  resetCueVolume,
  setCueTime,
  setCueVolume,
  sfxPreviewUrl,
  volumeToPercent,
  type SfxCue,
  type SfxId,
} from './sfx-cues.logic';
import { playSfxPreview } from './sfx-preview';

const LABEL_CLS = 'block text-xs font-semibold uppercase tracking-widest text-gray-400';

const ICON_BUTTON_CLS =
  'tap inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-foreground/5 hover:text-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 active:scale-95';

interface SfxCuesPanelProps {
  cues: SfxCue[] | undefined;
  /** The schema cap: 32 for a section, 64 for the whole video. */
  max: number;
  /** What `at` is measured against (section or whole-video time). */
  hint: string;
  onChange: (cues: SfxCue[] | undefined) => void;
}

const preview = (id: SfxId, volume: number) => {
  playSfxPreview(sfxPreviewUrl(id), volume).catch(() => {});
};

export const SfxCuesPanel = ({ cues, max, hint, onChange }: SfxCuesPanelProps) => {
  const { t } = useTranslation('admin');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const libraryId = useId();
  const list = cues ?? [];
  const full = list.length >= max;

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">{hint}</p>
      {list.length === 0 && <p className="text-sm text-muted-foreground">{t('sfx.empty')}</p>}
      {list.length > 0 && (
        <ul className="space-y-2" aria-label={t('sfx.listLabel')}>
          {list.map((cue, index) => (
            <CueRow
              // Cues carry no id; the index is their identity in the descriptor too.
              key={index}
              cue={cue}
              onTime={(at) => {
                onChange(setCueTime(list, index, at));
              }}
              onVolume={(volume) => {
                onChange(setCueVolume(list, index, volume));
              }}
              onResetVolume={() => {
                onChange(resetCueVolume(list, index));
              }}
              onRemove={() => {
                onChange(removeCue(list, index));
              }}
            />
          ))}
        </ul>
      )}
      <button
        type="button"
        disabled={full}
        aria-expanded={libraryOpen}
        aria-controls={libraryId}
        onClick={() => {
          setLibraryOpen(!libraryOpen);
        }}
        className="tap inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-foreground/10 bg-surface px-3 text-sm font-semibold text-foreground transition-colors hover:border-brand-500/50 hover:bg-brand-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-50"
      >
        <Plus className="size-4 text-brand-500" aria-hidden />
        {t('sfx.add')}
      </button>
      {full && <p className="text-xs text-gray-500 dark:text-gray-400">{t('sfx.full', { max })}</p>}
      {libraryOpen && !full && (
        <SfxLibrary
          id={libraryId}
          onPick={(id) => {
            onChange(addCue(list, id, max));
            setLibraryOpen(false);
          }}
        />
      )}
    </div>
  );
};

interface CueRowProps {
  cue: SfxCue;
  onTime: (at: SfxCue['at']) => void;
  onVolume: (volume: number) => void;
  onResetVolume: () => void;
  onRemove: () => void;
}

const CueRow = ({ cue, onTime, onVolume, onResetVolume, onRemove }: CueRowProps) => {
  const { t } = useTranslation('admin');
  const id = cueLibraryId(cue);
  const name = id === undefined ? t('sfx.composed') : t(`sfx.library.${id}`);
  const volume = cue.volume ?? cueDefaultVolume(cue);

  return (
    <li className="space-y-2 rounded-xl border border-foreground/10 bg-surface p-3">
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{name}</span>
        {id !== undefined && (
          <button
            type="button"
            aria-label={t('sfx.preview', { name, percent: volumeToPercent(volume) })}
            onClick={() => {
              preview(id, volume);
            }}
            className={ICON_BUTTON_CLS}
          >
            <Play className="size-4" aria-hidden />
          </button>
        )}
        <button type="button" aria-label={t('sfx.remove', { name })} onClick={onRemove} className={ICON_BUTTON_CLS}>
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <CueTimeField name={name} at={cue.at} onChange={onTime} />
      <CueVolumeSlider
        name={name}
        volume={cue.volume}
        defaultVolume={cueDefaultVolume(cue)}
        onChange={onVolume}
        onReset={onResetVolume}
      />
    </li>
  );
};

// The field keeps the author's text while it is invalid (and says why), committing only what the engine
// accepts. A change from elsewhere (undo, the JSON editor) resets it.
const CueTimeField = ({
  name,
  at,
  onChange,
}: {
  name: string;
  at: SfxCue['at'];
  onChange: (at: SfxCue['at']) => void;
}) => {
  const { t } = useTranslation('admin');
  const inputId = useId();
  const errorId = useId();
  const [draft, setDraft] = useState({ text: formatCueTime(at), committed: at });

  if (draft.committed !== at) setDraft({ text: formatCueTime(at), committed: at });

  const invalid = !parseCueTime(draft.text).ok;

  return (
    <div>
      <label htmlFor={inputId} className={cn(LABEL_CLS, 'mb-1')}>
        {t('sfx.time')}
      </label>
      <input
        id={inputId}
        type="text"
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        value={draft.text}
        aria-label={t('sfx.timeLabel', { name })}
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId : undefined}
        onChange={(event) => {
          const text = event.target.value;
          const parsed = parseCueTime(text);

          if (!parsed.ok) {
            setDraft({ text, committed: at });

            return;
          }

          setDraft({ text, committed: parsed.at });
          onChange(parsed.at);
        }}
        className={cn(
          EDITOR_INPUT_CLASS,
          'min-h-11 font-mono text-sm',
          invalid && 'border-[var(--color-error)] hover:border-[var(--color-error)]'
        )}
      />
      {invalid && (
        <p id={errorId} className="mt-1 text-xs text-[var(--color-error)]">
          {t('sfx.timeError')}
        </p>
      )}
    </div>
  );
};

const CueVolumeSlider = ({
  name,
  volume,
  defaultVolume,
  onChange,
  onReset,
}: {
  name: string;
  volume: number | undefined;
  defaultVolume: number;
  onChange: (volume: number) => void;
  onReset: () => void;
}) => {
  const { t } = useTranslation('admin');
  const inputId = useId();
  const percent = volumeToPercent(volume ?? defaultVolume);
  const valueText = volume === undefined ? t('sfx.volumeDefault', { percent }) : t('sfx.volumeValue', { percent });

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={inputId} className={LABEL_CLS}>
          {t('sfx.volume')}
        </label>
        <div className="flex items-center gap-1">
          <span className="tabular-nums text-xs text-gray-500">{valueText}</span>
          {volume !== undefined && (
            <button
              type="button"
              aria-label={t('sfx.resetVolume', { name, percent: volumeToPercent(defaultVolume) })}
              onClick={onReset}
              className={ICON_BUTTON_CLS}
            >
              <RotateCcw className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
      </div>
      <input
        id={inputId}
        type="range"
        min={0}
        max={200}
        step={5}
        value={percent}
        aria-label={t('sfx.volumeLabel', { name })}
        aria-valuetext={valueText}
        onChange={(event) => {
          onChange(percentToVolume(Number(event.target.value)));
        }}
        style={{ ...rangeFill(percent, 0, 200), height: '2.75rem' }}
        className="studio-range"
      />
    </div>
  );
};

// The bundled library, each sound with when to use it, a preview at its own level and an add action.
export const SfxLibrary = ({ id, onPick }: { id: string; onPick: (id: SfxId) => void }) => {
  const { t } = useTranslation('admin');

  return (
    <ul
      id={id}
      aria-label={t('sfx.libraryLabel')}
      className="max-h-96 space-y-1 overflow-y-auto overscroll-contain rounded-xl border border-foreground/10 bg-surface p-1 [scrollbar-width:thin]"
    >
      {SFX_ITEMS.map((item) => {
        const name = t(`sfx.library.${item.id}`);

        return (
          <li key={item.id} className="flex items-stretch gap-1">
            <button
              type="button"
              aria-label={t('sfx.preview', { name, percent: volumeToPercent(item.defaultVolume) })}
              onClick={() => {
                preview(item.id, item.defaultVolume);
              }}
              className={ICON_BUTTON_CLS}
            >
              <Play className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              aria-label={t('sfx.addLabel', { name })}
              onClick={() => {
                onPick(item.id);
              }}
              className="tap flex min-h-11 min-w-0 flex-1 flex-col items-start justify-center rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-brand-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
            >
              <span className="text-sm font-semibold text-foreground">{name}</span>
              <span className="text-xs leading-snug text-gray-500 dark:text-gray-400">
                {t(`sfx.useWhen.${item.id}`)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
};
