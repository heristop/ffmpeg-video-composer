// The shared "Entrance" control for sugar text (title card, lower third, caption). A segmented control
// picks the entrance style; a small disclosure exposes the timing (delay / duration / distance). The
// value is the descriptor `reveal` shape — a bare type string when only the style is set, or the full
// object once any timing is overridden — so it round-trips through buildDescriptor unchanged.
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { REVEAL_TYPES, REVEAL_EASINGS } from 'ffmpeg-video-composer/src/schemas/effects.schemas.ts';
import type { Reveal } from '../templateEditorModel';
import { SegmentedControl, RangeSlider, type SegmentOption } from './controls';
import { SectionDisclosure } from './SectionDisclosure';

type RevealType = (typeof REVEAL_TYPES)[number];
type RevealEasing = (typeof REVEAL_EASINGS)[number];
type RevealObject = {
  type: RevealType;
  delay?: number;
  duration?: number;
  distance?: number;
  easing?: RevealEasing;
};

const MOVING: RevealType[] = ['rise', 'slide-left', 'slide-right'];
const DEFAULT_DELAY = 0.3;
const DEFAULT_DURATION = 0.6;
const DEFAULT_DISTANCE = 60;

// value → locale key suffix for the easing labels (flat keys, matching the reveal.* namespace).
const EASING_LABEL_KEYS: Record<RevealEasing, string> = {
  linear: 'easingLinear',
  'ease-out': 'easingEaseOut',
  'ease-in-out': 'easingEaseInOut',
  'ease-out-back': 'easingEaseOutBack',
};

// Store a slider value equal to the engine default as "unset" so descriptors stay minimal and the
// timing summary/reset affordance stay honest.
const orUnset = (value: number, defaultValue: number): number | undefined =>
  value === defaultValue ? undefined : value;

// The collapsed Timing summary: every overridden knob ("Delay 0.5s · Ease out"), or the default hint.
function timingSummary(t: TFunction<'admin'>, current: RevealObject): string {
  const parts = [
    current.delay === undefined ? null : `${t('reveal.delay')} ${current.delay}s`,
    current.duration === undefined ? null : `${t('reveal.duration')} ${current.duration}s`,
    current.distance === undefined ? null : `${t('reveal.distance')} ${current.distance}px`,
    current.easing === undefined ? null : t(`reveal.${EASING_LABEL_KEYS[current.easing]}`),
  ].filter((part): part is string => part !== null);

  return parts.length > 0 ? parts.join(' · ') : t('reveal.summaryDefault');
}

function normalize(reveal: Reveal | undefined): RevealObject {
  if (reveal === undefined) return { type: 'none' };

  if (typeof reveal === 'string') return { type: reveal };

  return reveal;
}

// Emit the bare type when nothing is overridden (matches authored templates); the full object once it is.
function pack(obj: RevealObject): Reveal | undefined {
  if (obj.type === 'none') return undefined;

  const hasOverride =
    obj.delay !== undefined || obj.duration !== undefined || obj.distance !== undefined || obj.easing !== undefined;

  return hasOverride ? obj : obj.type;
}

interface RevealControlProps {
  reveal: Reveal | undefined;
  onChange: (reveal: Reveal | undefined) => void;
}

export const RevealControl = ({ reveal, onChange }: RevealControlProps) => {
  const { t } = useTranslation('admin');
  const current = normalize(reveal);

  const options: ReadonlyArray<SegmentOption<RevealType>> = REVEAL_TYPES.map((value) => ({
    value,
    label: t(`reveal.${value}`),
  }));

  const set = (patch: Partial<RevealObject>) => {
    onChange(pack({ ...current, ...patch }));
  };

  return (
    <div className="space-y-2">
      <SegmentedControl
        label={t('reveal.label')}
        value={current.type}
        options={options}
        onChange={(type) => {
          set({ type });
        }}
      />
      {current.type !== 'none' && (
        <SectionDisclosure label={t('reveal.advanced')} summary={timingSummary(t, current)}>
          <RangeSlider
            label={t('reveal.delay')}
            value={current.delay ?? DEFAULT_DELAY}
            min={0}
            max={2}
            step={0.05}
            format={(v) => `${v}s`}
            resetTo={DEFAULT_DELAY}
            onChange={(delay) => {
              set({ delay: orUnset(delay, DEFAULT_DELAY) });
            }}
          />
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
          <div>
            <SegmentedControl
              label={t('reveal.easing')}
              value={current.easing ?? 'linear'}
              options={REVEAL_EASINGS.map((value) => ({ value, label: t(`reveal.${EASING_LABEL_KEYS[value]}`) }))}
              onChange={(easing) => {
                // Linear is the engine default — emit it as "unset" so descriptors stay minimal.
                set({ easing: easing === 'linear' ? undefined : easing });
              }}
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('reveal.easingHint')}</p>
          </div>
        </SectionDisclosure>
      )}
    </div>
  );
};
