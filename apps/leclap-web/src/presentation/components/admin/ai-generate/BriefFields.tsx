// The brief: a labelled textarea with live length guidance, example prompts that fill it in one tap,
// and the two hints a person most often wants to pin (format and length), side by side on one
// baseline. Everything else is left to the model.
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { Orientation } from '@/application/usecases/ai-template/system-prompt';
import { cn } from '@/lib/utils';
import { SegmentedControl, Select, SelectItem, SelectTrigger, SelectValue } from '@/presentation/components/ui';
import { EditorSelectContent } from '../editor/editor-select-content';
import { MIN_BRIEF_LENGTH } from './ai-generation.logic';
import { FIELD_HELP, FIELD_LABEL, FOCUS_RING } from './ai-form-styles';

export const EXAMPLE_KEYS = ['launch', 'tutorial', 'hook', 'cinematic', 'recap', 'event'] as const;
const DURATIONS = ['auto', '15', '30', '60'] as const;
const ORIENTATIONS = ['auto', 'landscape', 'portrait', 'square'] as const;

interface BriefFieldsProps {
  brief: string;
  onBriefChange: (brief: string) => void;
  orientation: Orientation | 'auto';
  onOrientationChange: (value: Orientation | 'auto') => void;
  duration: string;
  onDurationChange: (value: string) => void;
  disabled: boolean;
}

type BriefProps = Pick<BriefFieldsProps, 'brief' | 'onBriefChange' | 'disabled'>;

const Brief = ({ brief, onBriefChange, disabled }: BriefProps) => {
  const { t } = useTranslation('ai');
  const id = useId();
  const length = brief.trim().length;
  const tooShort = length > 0 && length < MIN_BRIEF_LENGTH;

  return (
    <div>
      <label htmlFor={id} className={FIELD_LABEL}>
        {t('brief.label')}
      </label>
      <textarea
        id={id}
        value={brief}
        rows={4}
        disabled={disabled}
        placeholder={t('brief.placeholder')}
        aria-describedby={`${id}-help`}
        aria-invalid={tooShort || undefined}
        onChange={(event) => {
          onBriefChange(event.target.value);
        }}
        className="field-focus-gradient block min-h-28 w-full resize-y rounded-lg border border-divider bg-surface-2 px-3 py-2.5 text-sm leading-relaxed text-foreground placeholder:text-gray-500 transition-colors disabled:opacity-60"
      />
      <div className="mt-2 flex items-start justify-between gap-4">
        <p id={`${id}-help`} aria-live="polite" className={cn(FIELD_HELP, tooShort && 'text-[var(--color-warning)]')}>
          {tooShort ? t('brief.tooShort') : t('brief.hint')}
        </p>
        {length > 0 && (
          <span aria-hidden className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {t('brief.count', { count: length })}
          </span>
        )}
      </div>
    </div>
  );
};

// One tidy row of compact example chips that scrolls sideways (edge-faded) instead of wrapping into
// ragged lines; each chip is a real button, so Tab walks them and brings the focused one into view.
const Examples = ({ onBriefChange, disabled }: Omit<BriefProps, 'brief'>) => {
  const { t } = useTranslation('ai');
  const id = useId();

  return (
    <div>
      <p id={id} className={FIELD_LABEL}>
        {t('brief.examples')}
      </p>
      <ul
        aria-labelledby={id}
        className="track-edge-fade -mx-1 flex snap-x scroll-px-1 gap-2 overflow-x-auto py-1 pl-1 pr-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {EXAMPLE_KEYS.map((key) => (
          <li key={key} className="shrink-0 snap-start">
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                onBriefChange(t(`examples.${key}`));
              }}
              className={cn(
                'tap h-8 max-w-[16rem] truncate rounded-full border border-divider bg-surface-2 px-3 text-xs text-foreground/85 transition-colors duration-200 hover:border-brand-500/50 hover:text-foreground disabled:opacity-50 motion-reduce:transition-none',
                FOCUS_RING
              )}
              title={t(`examples.${key}`)}
            >
              {t(`examples.${key}`)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

type HintsProps = Omit<BriefFieldsProps, 'brief' | 'onBriefChange'>;

const Hints = ({ orientation, onOrientationChange, duration, onDurationChange, disabled }: HintsProps) => {
  const { t } = useTranslation('ai');
  const id = useId();

  return (
    <fieldset
      disabled={disabled}
      className="grid items-start gap-x-6 gap-y-5 disabled:opacity-60 @lg:grid-cols-[auto_minmax(8rem,11rem)]"
    >
      <div className="min-w-0">
        <span id={`${id}-format`} className={FIELD_LABEL}>
          {t('hints.orientation')}
        </span>
        <SegmentedControl
          ariaLabel={t('hints.orientation')}
          value={orientation}
          onChange={(value) => {
            onOrientationChange(value as Orientation | 'auto');
          }}
          classNames={{
            track: 'flex h-10 w-full items-center @lg:inline-flex @lg:w-auto',
            button: 'flex-1 px-3 py-1.5 text-[0.8125rem]',
          }}
          options={ORIENTATIONS.map((value) => ({ value, label: t(`hints.${value}`) }))}
        />
      </div>
      <div>
        <span id={`${id}-duration`} className={FIELD_LABEL}>
          {t('hints.duration')}
        </span>
        <Select value={duration} onValueChange={onDurationChange} disabled={disabled}>
          <SelectTrigger aria-labelledby={`${id}-duration`} className="text-[0.8125rem]">
            <SelectValue />
          </SelectTrigger>
          <EditorSelectContent>
            {DURATIONS.map((value) => (
              <SelectItem key={value} value={value}>
                {value === 'auto' ? t('hints.auto') : t('hints.seconds', { count: Number(value) })}
              </SelectItem>
            ))}
          </EditorSelectContent>
        </Select>
      </div>
    </fieldset>
  );
};

export const BriefFields = ({ brief, onBriefChange, disabled, ...hints }: BriefFieldsProps) => (
  <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
    <Brief brief={brief} onBriefChange={onBriefChange} disabled={disabled} />
    <Examples onBriefChange={onBriefChange} disabled={disabled} />
    <Hints disabled={disabled} {...hints} />
  </div>
);
