// Canvas-free animation overlay pieces shared by AnimationGallery (which adds the drag canvas) and the
// canvas-less PlacementControls inspector:
//   - AnimationSource: the picker. In a section (a host that can hold engine effects) it opens with a
//     top-level "Effects | Animation files" switch, so the two kinds never share a grid: Effects lists the
//     engine primitives and their combinations; Animation files holds the Library / Upload / Url tabs
//     (animationFiles). A host that only takes files (the whole-video overlays) shows the files side alone.
//   - AnimationPlayback: playback extent (forever / loops / seconds) + start offset + keep-last-frame.
// These are the single source for the animation source/playback UI so both consumers reuse them.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox, SegmentedControl } from '@/presentation/components/ui';
import { NumberField } from '@/presentation/components/ui/NumberField';
import { cn } from '@/lib/utils';
import type { AnimationAsset } from '@/data/mediaCatalog';
import type { AnimationEffectPreset, AnimationOverlay, EngineLibraryEntry } from '../templateEditorModel';
import { EffectLibraryPicker } from './AnimationLibraryPicker';
import { AnimationFilesPane } from './animationFiles';
import { FAMILY_ICON, FAMILY_TONE, FamilyHeader, type AnimationFamily } from './animationKinds';

/** Which side of the picker shows: the engine effects, or the animation files. */
export type AnimationPickMode = AnimationFamily;

// A chosen file reopens on the files side; an empty slot opens where it was asked for, effects by default.
export const pickInitialMode = (value?: AnimationOverlay, requested?: AnimationPickMode): AnimationPickMode =>
  value?.url ? 'file' : (requested ?? 'effect');

interface AnimationSourceProps {
  value: AnimationOverlay | undefined;
  onChange: (value?: AnimationOverlay) => void;
  /** Override the sample list with a curated one (config-driven); defaults to the bundled samples. */
  library?: AnimationAsset[];
  /** Inserts an engine primitive in place of this overlay (a section host); absent = files only. */
  onPickEngine?: (entry: EngineLibraryEntry) => void;
  /** Inserts a two-part recipe in place of this overlay. */
  onPickRecipe?: (preset: AnimationEffectPreset) => void;
  /** The side an empty slot opens on (the add menu's "Effect" vs "Animation file"). */
  initialMode?: AnimationPickMode;
}

export const AnimationSource = ({
  value,
  onChange,
  library,
  onPickEngine,
  onPickRecipe,
  initialMode,
}: AnimationSourceProps) => {
  const [mode, setMode] = useState<AnimationPickMode>(() => pickInitialMode(value, initialMode));

  if (!onPickEngine) return <AnimationFilesPane value={value} onChange={onChange} library={library} />;

  return (
    <div className="space-y-3">
      <KindSwitch mode={mode} setMode={setMode} />
      {mode === 'effect' ? (
        <div className="space-y-3">
          <FamilyHeader family="effect" titled={false} />
          <EffectLibraryPicker onPickEngine={onPickEngine} onPickRecipe={onPickRecipe} />
        </div>
      ) : (
        <AnimationFilesPane value={value} onChange={onChange} library={library} titled={false} />
      )}
    </div>
  );
};

const KIND_SWITCH: AnimationPickMode[] = ['effect', 'file'];

// The top-level switch: full width, each side with its own glyph in its own tone.
const KindSwitch = ({ mode, setMode }: { mode: AnimationPickMode; setMode: (mode: AnimationPickMode) => void }) => {
  const { t } = useTranslation('admin');

  return (
    <SegmentedControl
      ariaLabel={t('animation.kind.switch')}
      value={mode}
      onChange={(next) => {
        setMode(next as AnimationPickMode);
      }}
      options={KIND_SWITCH.map((family) => {
        const Icon = FAMILY_ICON[family];

        return {
          value: family,
          label: (
            <span className="inline-flex items-center justify-center gap-1.5">
              <Icon className={cn('h-3.5 w-3.5', FAMILY_TONE[family].text)} aria-hidden />
              {t(`animation.kind.${family}.title`)}
            </span>
          ),
        };
      })}
      classNames={{ track: 'flex w-full', button: 'flex-1 font-semibold' }}
    />
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
