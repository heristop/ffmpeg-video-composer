// "Fine-tune" collapsible under the LookGallery: six grade sliders with per-field reset, a live
// CSS-filter preview, plus the engine's deeper grade fields — three-way color balance
// (shadows/midtones/highlights RGB) and an FFmpeg curves preset. Maps 1:1 to section.grade
// (GradeSchema); unchanged fields are pruned so the descriptor never carries no-op defaults.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ChevronDownIcon } from '@/presentation/components/icons/chevron-down';
import { SlidersHorizontalIcon } from '@/presentation/components/icons/sliders-horizontal';
import { useIconHover } from '@/presentation/components/icons/useIconHover';
import { cn } from '@/lib/utils';
import { Select, SelectTrigger, SelectValue, SelectItem } from '@/presentation/components/ui';
import type { Grade } from '../templateEditorModel';
import {
  GRADE_DEFAULTS,
  COLOR_BALANCE_RANGES,
  COLOR_CHANNELS,
  gradeFilter,
  pruneGrade,
  type GradeKey,
  type ColorBalanceRange,
  type ColorChannel,
} from './lookFilters';
import { PreviewSurface } from './PreviewSurface';
import { RangeSlider } from './controls';
import { EditorSelectContent } from './editor-select-content';

// FFmpeg's built-in `curves` filter presets — grade.curvesPreset passes straight through to
// `curves=preset=<name>` (see engine editor/presets/looks.ts), so only these names are valid.
const CURVES_PRESETS = [
  'color_negative',
  'cross_process',
  'darker',
  'increase_contrast',
  'lighter',
  'linear_contrast',
  'medium_contrast',
  'negative',
  'strong_contrast',
  'vintage',
] as const;

// Sentinel for "no curves preset" — Radix Select rejects empty-string item values.
const CURVES_NONE = 'none';

interface GradePanelProps {
  grade: Grade | undefined;
  onChange: (grade: Grade | undefined) => void;
}

interface SliderSpec {
  key: GradeKey;
  min: number;
  max: number;
  step: number;
  /** Value-chip formatter — units the raw readout (degrees, pixels) where one applies. */
  format?: (value: number) => string;
}

const SLIDERS: SliderSpec[] = [
  { key: 'brightness', min: -1, max: 1, step: 0.05 },
  { key: 'contrast', min: 0, max: 2, step: 0.05 },
  { key: 'saturation', min: 0, max: 3, step: 0.05 },
  { key: 'gamma', min: 0.1, max: 3, step: 0.05 },
  { key: 'hue', min: -180, max: 180, step: 1, format: (v) => `${v}°` },
  { key: 'blur', min: 0, max: 20, step: 0.5, format: (v) => `${v}px` },
  // Film-grain strength (effects-pack) — lowered to the FFmpeg `noise` filter.
  { key: 'grain', min: 0, max: 1, step: 0.02, format: (v) => `${Math.round(v * 100)}%` },
];

const GradeIndicators = ({
  active,
  open,
  count,
  t,
}: {
  active: boolean;
  open: boolean;
  count: number;
  t: TFunction<'admin'>;
}) => (
  <>
    {active && open ? (
      <span className="h-1.5 w-1.5 rounded-full bg-brand-500" role="img" aria-label={t('grade.customised')} />
    ) : null}
    {active && !open ? (
      <span className="ml-auto shrink-0 truncate rounded-md bg-foreground/[0.06] px-2 py-0.5 text-[0.7rem] font-medium normal-case tracking-normal text-gray-500 dark:text-gray-400">
        {t('grade.adjustedCount', { count })}
      </span>
    ) : null}
  </>
);

const GradeBody = ({
  grade,
  t,
  setField,
  setBalance,
  setCurves,
}: {
  grade: Grade | undefined;
  t: TFunction<'admin'>;
  setField: (key: GradeKey, value: number) => void;
  setBalance: (range: ColorBalanceRange, channel: ColorChannel, value: number) => void;
  setCurves: (preset: string) => void;
}) => (
  <div className="grid gap-4 px-3 pb-3 sm:grid-cols-[1fr_8rem]">
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {SLIDERS.map((spec) => (
          <RangeSlider
            key={spec.key}
            label={t(`grade.${spec.key}`)}
            value={grade?.[spec.key] ?? GRADE_DEFAULTS[spec.key]}
            min={spec.min}
            max={spec.max}
            step={spec.step}
            format={spec.format}
            resetTo={GRADE_DEFAULTS[spec.key]}
            onChange={(v) => {
              setField(spec.key, v);
            }}
          />
        ))}
      </div>
      <ColorBalanceBlock grade={grade} t={t} onSet={setBalance} />
      <div>
        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-gray-400">
          {t('grade.curvesPreset')}
        </span>
        <Select value={grade?.curvesPreset ?? CURVES_NONE} onValueChange={setCurves}>
          <SelectTrigger aria-label={t('grade.curvesPreset')} className="w-full">
            <SelectValue placeholder={t('grade.curvesNone')} />
          </SelectTrigger>
          <EditorSelectContent>
            <SelectItem value={CURVES_NONE}>{t('grade.curvesNone')}</SelectItem>
            {CURVES_PRESETS.map((preset) => (
              <SelectItem key={preset} value={preset}>
                {t(`grade.curves.${preset}`)}
              </SelectItem>
            ))}
          </EditorSelectContent>
        </Select>
      </div>
    </div>
    <PreviewSurface filter={gradeFilter(grade)} className="h-24 w-full sm:sticky sm:top-2 sm:self-start" />
  </div>
);

export const GradePanel = ({ grade, onChange }: GradePanelProps) => {
  const { t } = useTranslation('admin');
  const [open, setOpen] = useState(false);
  // The grade prop is pruned on every write, so its key count = how many knobs are off default
  // (colorBalance and curvesPreset each count as one).
  const adjustedCount = grade === undefined ? 0 : Object.keys(grade).length;
  const active = adjustedCount > 0;
  const { ref: slidersRef, hoverProps: slidersHoverProps } = useIconHover();
  const { ref: chevronRef, hoverProps: chevronHoverProps } = useIconHover();

  const setField = (key: GradeKey, value: number) => {
    onChange(pruneGrade({ ...grade, [key]: value }));
  };

  const setBalance = (range: ColorBalanceRange, channel: ColorChannel, value: number) => {
    const current = grade?.colorBalance?.[range] ?? { r: 0, g: 0, b: 0 };
    const colorBalance = { ...grade?.colorBalance, [range]: { ...current, [channel]: value } };
    onChange(pruneGrade({ ...grade, colorBalance }));
  };

  const setCurves = (preset: string) => {
    // The sentinel matches no preset, so it clears the field.
    onChange(pruneGrade({ ...grade, curvesPreset: CURVES_PRESETS.find((name) => name === preset) }));
  };

  return (
    <div className="rounded-xl border border-foreground/10 bg-surface">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        className="tap flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold uppercase tracking-widest text-gray-400 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
        onMouseEnter={() => {
          slidersHoverProps.onMouseEnter();
          chevronHoverProps.onMouseEnter();
        }}
        onMouseLeave={() => {
          slidersHoverProps.onMouseLeave();
          chevronHoverProps.onMouseLeave();
        }}
      >
        <SlidersHorizontalIcon ref={slidersRef} size={14} /> {t('grade.fineTune')}
        <GradeIndicators active={active} open={open} count={adjustedCount} t={t} />
        <ChevronDownIcon
          ref={chevronRef}
          size={16}
          className={cn('transition-transform', open && 'rotate-180', (open || !active) && 'ml-auto')}
        />
      </button>
      {open ? (
        <GradeBody grade={grade} t={t} setField={setField} setBalance={setBalance} setCurves={setCurves} />
      ) : null}
    </div>
  );
};

// Three-way color balance: one RGB slider row per tonal range. A collapsed disclosure so the six
// primary sliders stay the visual anchor of the panel.
const ColorBalanceBlock = ({
  grade,
  t,
  onSet,
}: {
  grade: Grade | undefined;
  t: TFunction<'admin'>;
  onSet: (range: ColorBalanceRange, channel: ColorChannel, value: number) => void;
}) => {
  const [open, setOpen] = useState(false);
  const active = grade?.colorBalance !== undefined;

  return (
    <div className="rounded-lg border border-foreground/10">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        className="tap flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold uppercase tracking-widest text-gray-400 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
      >
        {t('grade.colorBalance')}
        {active && open && (
          <span className="h-1.5 w-1.5 rounded-full bg-brand-500" role="img" aria-label={t('grade.customised')} />
        )}
        {/* Collapsed at-a-glance state: which tonal ranges carry a shift ("Shadows · Highlights"). */}
        {active && !open && (
          <span className="ml-auto shrink-0 truncate rounded-md bg-foreground/[0.06] px-2 py-0.5 text-[0.7rem] font-medium normal-case tracking-normal text-gray-500 dark:text-gray-400">
            {COLOR_BALANCE_RANGES.filter((range) => grade.colorBalance?.[range])
              .map((range) => t(`grade.${range}`))
              .join(' · ')}
          </span>
        )}
        <ChevronDownIcon
          size={16}
          className={cn('shrink-0 transition-transform', open && 'rotate-180', (open || !active) && 'ml-auto')}
        />
      </button>
      {open && (
        <div className="space-y-3 px-3 pb-3">
          {COLOR_BALANCE_RANGES.map((range) => (
            <div key={range}>
              <span className="mb-1 block text-xs font-medium text-gray-500">{t(`grade.${range}`)}</span>
              {/* One column on narrow panels so each RGB slider keeps room for its value + reset. */}
              <div className="grid gap-2 sm:grid-cols-3">
                {COLOR_CHANNELS.map((channel) => (
                  <RangeSlider
                    key={channel}
                    label={t(`grade.channel${channel.toUpperCase()}`)}
                    value={grade?.colorBalance?.[range]?.[channel] ?? 0}
                    min={-1}
                    max={1}
                    step={0.05}
                    resetTo={0}
                    onChange={(v) => {
                      onSet(range, channel, v);
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
