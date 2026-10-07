// The shared "Exit" control for animated text overlays. A segmented control picks the exit style; a
// disclosure exposes the timing (after / duration / distance). The value is the descriptor `exit`
// shape — a bare type string when only the style is set, or the full object once any timing is
// overridden — so it round-trips through buildDescriptor unchanged. `after` is when the exit begins
// (seconds from the section start); left unset, the engine times it to end at the section end.
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { REVEAL_TYPES } from 'ffmpeg-video-composer/src/schemas/effects.schemas.ts';
import type { EasingSpec } from 'ffmpeg-video-composer/src/core/motion/easing.ts';
import { CUSTOM_EASING, easingChoice, easingLabel, easingOptions } from './easingOptions';
import type { Exit } from '../templateEditorModel';
import { SegmentedControl, RangeSlider, type SegmentOption } from './controls';
import { SectionDisclosure } from './SectionDisclosure';

type ExitType = (typeof REVEAL_TYPES)[number];
type ExitObject = {
  type: ExitType;
  after?: number;
  duration?: number;
  distance?: number;
  easing?: EasingSpec;
};
const MOVING: ExitType[] = ['rise', 'slide-left', 'slide-right'];
const DEFAULT_AFTER = 2.5;
const DEFAULT_DURATION = 0.6;
const DEFAULT_DISTANCE = 60;

// Store a slider value equal to the engine default as "unset" so descriptors stay minimal and the
// timing summary/reset affordance stay honest.
const orUnset = (value: number, defaultValue: number): number | undefined =>
  value === defaultValue ? undefined : value;

// The collapsed Timing summary: every overridden knob ("Starts after 3s · Duration 1s"), or the
// default hint (the engine times the exit to end at the section end).
function timingSummary(t: TFunction<'admin'>, current: ExitObject): string {
  const parts = [
    current.after === undefined ? null : `${t('exit.after')} ${current.after}s`,
    current.duration === undefined ? null : `${t('reveal.duration')} ${current.duration}s`,
    current.distance === undefined ? null : `${t('reveal.distance')} ${current.distance}px`,
    current.easing === undefined ? null : easingLabel(t, current.easing),
  ].filter((part): part is string => part !== null);

  return parts.length > 0 ? parts.join(' · ') : t('exit.summaryDefault');
}

function normalize(exit: Exit | undefined): ExitObject {
  if (exit === undefined) return { type: 'none' };

  if (typeof exit === 'string') return { type: exit };

  return exit;
}

// Emit the bare type when no timing is overridden; the full object once it is.
function pack(obj: ExitObject): Exit | undefined {
  if (obj.type === 'none') return undefined;

  const hasTiming =
    obj.after !== undefined || obj.duration !== undefined || obj.distance !== undefined || obj.easing !== undefined;

  return hasTiming ? obj : obj.type;
}

interface ExitControlProps {
  exit: Exit | undefined;
  onChange: (exit: Exit | undefined) => void;
}

export const ExitControl = ({ exit, onChange }: ExitControlProps) => {
  const { t } = useTranslation('admin');
  const current = normalize(exit);

  const options: ReadonlyArray<SegmentOption<ExitType>> = REVEAL_TYPES.map((value) => ({
    value,
    label: t(`reveal.${value}`),
  }));

  const set = (patch: Partial<ExitObject>) => {
    onChange(pack({ ...current, ...patch }));
  };

  return (
    <div className="space-y-2">
      <SegmentedControl
        label={t('exit.label')}
        value={current.type}
        options={options}
        onChange={(type) => {
          set({ type });
        }}
      />
      {current.type !== 'none' && (
        <SectionDisclosure label={t('reveal.advanced')} summary={timingSummary(t, current)}>
          <div>
            <RangeSlider
              label={t('exit.after')}
              value={current.after ?? DEFAULT_AFTER}
              min={0}
              max={10}
              step={0.1}
              // Until the author drags, the engine times the exit itself — say so instead of
              // showing a start time that isn't stored.
              format={(v) => (current.after === undefined ? t('exit.auto') : `${v}s`)}
              onChange={(after) => {
                set({ after });
              }}
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('exit.afterHint')}</p>
          </div>
          <RangeSlider
            label={t('reveal.duration')}
            value={current.duration ?? DEFAULT_DURATION}
            min={0.1}
            max={2}
            step={0.05}
            format={(v) => `${v}s`}
            resetTo={DEFAULT_DURATION}
            onChange={(duration) => {
              set({ duration: orUnset(duration, DEFAULT_DURATION) });
            }}
          />
          {MOVING.includes(current.type) && (
            <RangeSlider
              label={t('reveal.distance')}
              value={current.distance ?? DEFAULT_DISTANCE}
              min={0}
              max={300}
              step={5}
              format={(v) => `${v}px`}
              resetTo={DEFAULT_DISTANCE}
              onChange={(distance) => {
                set({ distance: orUnset(distance, DEFAULT_DISTANCE) });
              }}
            />
          )}
          <SegmentedControl
            label={t('exit.easing')}
            value={easingChoice(current.easing)}
            options={easingOptions(t, current.easing)}
            onChange={(easing) => {
              // The authored curve is already selected; re-picking it changes nothing.
              if (easing === CUSTOM_EASING) return;

              set({ easing });
            }}
          />
        </SectionDisclosure>
      )}
    </div>
  );
};
