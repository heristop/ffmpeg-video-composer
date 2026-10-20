// Canvas-free placement controls shared by the (drag-canvas) OverlayPlacement panel and the canvas-less
// PlacementControls inspector: Position (X/Y) + Scale (W/H) numeric pairs, Opacity + Rotation sliders, and
// a reset-position/scale button. OverlayPlacementValue lives here (the subset of overlay fields these
// controls read/write) so both consumers depend on the single source. The owning PairField / AxisInput
// helpers live here too.
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { cn } from '@/lib/utils';
import type { OverlayFit, OverlayFlip } from '../templateEditorModel';
import { RotateCcw } from '@/presentation/components/icons';
import { parsePair, formatPair } from './animationOverlay';
import { RangeSlider, SegmentedControl } from './controls';
import { hasFlipAxis, toggleFlipAxis, type FlipAxis } from '@leclap/creative-kit/editor';

// The subset of overlay fields the shared placement controls read/write. Both AnimationOverlay and
// ImageOverlay carry these (string "x:y" position, string "w:h" scale, 0–1 opacity, degrees rotation,
// the fit mode that keeps a logo/sticker's aspect inside that scale box, and the mirror flip).
export interface OverlayPlacementValue {
  position?: string;
  scale?: string;
  fit?: OverlayFit;
  opacity?: number;
  rotation?: number;
  flip?: OverlayFlip;
}

interface PlacementFieldsProps {
  value: OverlayPlacementValue;
  onChange: (patch: OverlayPlacementValue) => void;
}

// Position/Scale/Opacity/Rotation + reset, with no canvas. The single source for the placement column.
export const PlacementFields = ({ value, onChange }: PlacementFieldsProps) => {
  const { t } = useTranslation('admin');

  return (
    <div className="min-w-[150px] flex-1 space-y-2">
      <PairField
        label={t('animation.position')}
        hint={t('animation.positionHint')}
        value={value.position}
        aLabel="X"
        bLabel="Y"
        placeholder="0"
        onChange={(position) => {
          onChange({ position });
        }}
      />
      <PairField
        label={t('animation.scale')}
        hint={t('animation.scaleHint')}
        value={value.scale}
        aLabel="W"
        bLabel="H"
        placeholder="auto"
        onChange={(scale) => {
          onChange({ scale });
        }}
      />
      {/* Fit only acts on a fixed W:H box, so the control appears once a scale is set. 'stretch'
          is the engine default and is stored as undefined to keep the descriptor minimal. */}
      {value.scale ? (
        <SegmentedControl<OverlayFit>
          label={t('animation.fit')}
          value={value.fit ?? 'stretch'}
          options={[
            { value: 'stretch', label: t('animation.fitStretch'), title: t('animation.fitStretchHint') },
            { value: 'contain', label: t('animation.fitContain'), title: t('animation.fitContainHint') },
            { value: 'cover', label: t('animation.fitCover'), title: t('animation.fitCoverHint') },
          ]}
          onChange={(fit) => {
            onChange({ fit: fit === 'stretch' ? undefined : fit });
          }}
        />
      ) : null}
      <RangeSlider
        label={t('animation.opacity')}
        value={value.opacity ?? 1}
        min={0}
        max={1}
        step={0.05}
        format={(v) => `${Math.round(v * 100)}%`}
        resetTo={1}
        onChange={(opacity) => {
          onChange({ opacity });
        }}
      />
      <RangeSlider
        label={t('animation.rotation')}
        value={value.rotation ?? 0}
        min={-180}
        max={180}
        step={1}
        format={(v) => `${Math.round(v)}°`}
        resetTo={0}
        onChange={(rotation) => {
          onChange({ rotation });
        }}
      />
      <MirrorToggle
        flip={value.flip}
        t={t}
        onChange={(flip) => {
          onChange({ flip });
        }}
      />
      {(value.position ?? value.scale) ? (
        <button
          type="button"
          onClick={() => {
            // Clearing the scale also clears the fit — without a box the mode has nothing to act on.
            onChange({ position: undefined, scale: undefined, fit: undefined });
          }}
          className="tap inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[0.65rem] font-semibold text-brand-600 transition-colors hover:bg-brand-500/10 dark:text-brand-300"
        >
          <RotateCcw className="size-3" aria-hidden />
          {t('animation.reset')}
        </button>
      ) : null}
    </div>
  );
};

// Mirror control: two independent axis toggles (both on = the descriptor's 'both') writing the single
// combined flip value. Checkbox semantics — unlike fit, the axes are not mutually exclusive.
const MirrorToggle = ({
  flip,
  t,
  onChange,
}: {
  flip: OverlayFlip | undefined;
  t: TFunction<'admin'>;
  onChange: (flip: OverlayFlip | undefined) => void;
}) => {
  const axes: Array<{ axis: FlipAxis; label: string; hint: string }> = [
    { axis: 'horizontal', label: t('animation.mirrorHorizontal'), hint: t('animation.mirrorHorizontalHint') },
    { axis: 'vertical', label: t('animation.mirrorVertical'), hint: t('animation.mirrorVerticalHint') },
  ];

  return (
    <div>
      <span className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-gray-400">
        {t('animation.mirror')}
      </span>
      <div
        role="group"
        aria-label={t('animation.mirror')}
        className="flex gap-1 rounded-xl border border-foreground/10 bg-surface p-1"
      >
        {axes.map(({ axis, label, hint }) => {
          const active = hasFlipAxis(flip, axis);

          return (
            <button
              key={axis}
              type="button"
              aria-pressed={active}
              title={hint}
              onClick={() => {
                onChange(toggleFlipAxis(flip, axis));
              }}
              className={cn(
                'tap flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-lg px-2 py-1 text-[0.65rem] font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
                active ? 'bg-brand-600 text-white shadow-sm shadow-brand-900/30' : 'text-gray-500 hover:text-foreground'
              )}
            >
              <span aria-hidden>{axis === 'horizontal' ? '↔' : '↕'}</span>
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

interface PairFieldProps {
  label: string;
  hint: string;
  value: string | undefined;
  aLabel: string;
  bLabel: string;
  placeholder: string;
  onChange: (value: string | undefined) => void;
}

// Two numeric inputs that read/write a single "a:b" descriptor pair (Position X/Y or Scale W/H).
export const PairField = ({ label, hint, value, aLabel, bLabel, placeholder, onChange }: PairFieldProps) => {
  const [a, b] = parsePair(value);

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-gray-400">{label}</span>
        <span className="truncate text-[0.6rem] text-gray-400">{hint}</span>
      </div>
      <div className="flex gap-1.5">
        <AxisInput
          axis={aLabel}
          value={a}
          placeholder={placeholder}
          onChange={(v) => {
            onChange(formatPair(v, b));
          }}
        />
        <AxisInput
          axis={bLabel}
          value={b}
          placeholder={placeholder}
          onChange={(v) => {
            onChange(formatPair(a, v));
          }}
        />
      </div>
    </div>
  );
};

export const AxisInput = ({
  axis,
  value,
  placeholder,
  onChange,
}: {
  axis: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) => (
  <label className="flex min-w-0 flex-1 items-center gap-1 rounded-lg border border-foreground/10 bg-foreground/5 px-2 py-1 focus-within:border-brand-500/50">
    <span className="text-[0.65rem] font-semibold text-gray-400">{axis}</span>
    <input
      inputMode="numeric"
      value={value}
      placeholder={placeholder}
      aria-label={axis}
      onChange={(e) => {
        onChange(e.target.value.replace(/[^\d-]/g, ''));
      }}
      className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-gray-400"
    />
  </label>
);
