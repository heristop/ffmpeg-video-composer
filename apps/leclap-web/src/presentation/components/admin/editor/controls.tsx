// Small, on-brand form primitives shared by the builder panels. Kept here so the
// panels stay focused and every slider/segmented-control looks identical.
import { useId, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw, Volume2, VolumeX } from '@/presentation/components/icons';
import { cn } from '@/lib/utils';

const LABEL_CLS = 'block text-xs font-semibold uppercase tracking-widest text-gray-400';

// The filled portion of a studio-range track, as a percent of its [min,max] span (clamped). Fed to the
// CSS `--range-pct` var so the lavender fill tracks the value cross-browser.
export const rangeFill = (value: number, min: number, max: number): CSSProperties => {
  const span = max - min;
  const pct = span > 0 ? ((value - min) / span) * 100 : 0;

  return { '--range-pct': `${Math.min(100, Math.max(0, pct))}%` } as CSSProperties;
};

interface RangeSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Optional formatter for the value chip (default: the raw number). */
  format?: (value: number) => string;
  /** When set, shows a reset-to-default control that writes this value. */
  resetTo?: number;
  onChange: (value: number) => void;
}

// Labelled range input with a live value chip and an optional reset-to-default button.
export const RangeSlider = ({ label, value, min, max, step = 0.01, format, resetTo, onChange }: RangeSliderProps) => {
  const { t } = useTranslation('admin');
  const id = useId();
  const showReset = resetTo !== undefined && value !== resetTo;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label htmlFor={id} className={LABEL_CLS}>
          {label}
        </label>
        <div className="flex items-center gap-1.5">
          <span className="tabular-nums text-xs text-gray-500">{format ? format(value) : value}</span>
          {showReset && (
            <button
              type="button"
              onClick={() => {
                onChange(resetTo);
              }}
              aria-label={t('controls.reset', { label })}
              className="tap rounded-md p-1.5 text-gray-500 transition-colors hover:bg-foreground/5 hover:text-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 active:scale-90"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          onChange(Number(e.target.value));
        }}
        style={rangeFill(value, min, max)}
        className="studio-range"
      />
    </div>
  );
};

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Accessible label when `label` is an icon/visual. */
  title?: string;
}

interface SegmentedControlProps<T extends string> {
  label?: string;
  value: T;
  options: ReadonlyArray<SegmentOption<T>>;
  onChange: (value: T) => void;
  className?: string;
}

// An accessible segmented toggle (radiogroup) — the on-brand replacement for a
// short Select. Keyboard-operable via the native radio semantics.
export const SegmentedControl = <T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: SegmentedControlProps<T>) => (
  <div className={className}>
    {label && <span className={cn(LABEL_CLS, 'mb-1')}>{label}</span>}
    <div
      role="radiogroup"
      aria-label={label}
      className="flex flex-wrap gap-1 rounded-xl border border-foreground/10 bg-surface p-1"
    >
      {options.map((option) => {
        const active = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={option.title}
            onClick={() => {
              onChange(option.value);
            }}
            className={cn(
              'tap flex flex-[1_0_auto] items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
              active ? 'bg-brand-600 text-white shadow-sm shadow-brand-900/30' : 'text-gray-500 hover:text-foreground'
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  </div>
);

interface VolumeSliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
}

// Extracted from the original AudioMixEditor: a 0..1 volume slider that shows a
// muted icon + "Muted" badge at zero, used by the global and per-section audio rows.
export const VolumeSlider = ({ label, value, onChange }: VolumeSliderProps) => {
  const { t } = useTranslation('admin');
  const muted = value === 0;

  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between text-xs font-medium">
        <span className="flex items-center gap-1.5 text-foreground/80">
          {muted ? <VolumeX className="size-3.5 text-[var(--color-error)]" /> : <Volume2 className="size-3.5" />}
          {label}
        </span>
        <span className="tabular-nums text-gray-500">
          {muted ? t('controls.muted') : `${Math.round(value * 100)}%`}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => {
          onChange(Number(e.target.value));
        }}
        style={rangeFill(value, 0, 1)}
        className="studio-range"
        aria-label={t('controls.volume', { label })}
      />
    </label>
  );
};
