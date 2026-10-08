// Pinned captions of a video scene: the words a transcription pinned into `subtitles.words` (on the
// phone, or with `leclap transcribe`), each editable in place to fix a misheard word. Timings stay the
// recogniser's. Shown only when the scene has pinned words; transcription itself is not in the browser yet.
import type { Subtitles } from 'ffmpeg-video-composer/src/schemas/subtitles.schemas.ts';
import { useTranslation } from 'react-i18next';
import { Type } from '@/presentation/components/icons';
import { cn } from '@/lib/utils';
import { SectionDisclosure } from '../SectionDisclosure';
import { editPinnedWord, isUnsure } from './pinned-words';

export const PINNED_CAPTION_KEYS = ['label', 'summary', 'hint', 'word'] as const;

interface PinnedCaptionsFieldProps {
  subtitles: Subtitles | undefined;
  onChange: (subtitles: Subtitles) => void;
}

export const PinnedCaptionsField = ({ subtitles, onChange }: PinnedCaptionsFieldProps) => {
  const { t } = useTranslation('admin');
  const words = subtitles?.words ?? [];

  if (!subtitles || words.length === 0) return null;

  const unsure = words.filter(isUnsure).length;

  return (
    <SectionDisclosure
      label={t('pinnedCaptions.label')}
      icon={<Type className="size-4 shrink-0 text-brand-500" aria-hidden />}
      summary={t('pinnedCaptions.summary', { count: words.length, unsure })}
    >
      <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">{t('pinnedCaptions.hint')}</p>
      <div className="flex flex-wrap gap-1">
        {words.map((word, index) => (
          // Keyed by the text too: an uncontrolled input only reads defaultValue on mount, so an outside
          // change (undo, a re-pin) must remount it to show the new word.
          <input
            key={`${index}-${word.start}-${word.text}`}
            defaultValue={word.text}
            data-unsure={isUnsure(word)}
            aria-label={t('pinnedCaptions.word', { start: word.start.toFixed(2) })}
            size={Math.max(2, word.text.length)}
            className={cn(
              'rounded border border-gray-200 bg-transparent px-1 py-0.5 text-sm dark:border-gray-700',
              isUnsure(word) && 'border-amber-400 dark:border-amber-500'
            )}
            onBlur={(event) => {
              const next = editPinnedWord(subtitles, index, event.currentTarget.value);

              if (next !== subtitles) onChange(next);
            }}
          />
        ))}
      </div>
    </SectionDisclosure>
  );
};
