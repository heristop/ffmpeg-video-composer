// "Take Counter" — a studio/movie-themed number input. A real <input type="number"> is the editable
// + a11y core (native spinbutton role, value announcements, native ↑/↓ + typing); the ▲▼ steppers,
// drag-to-scrub, and the quick value-slide are progressive enhancements layered on top. The slate
// surface, condensed tabular digits, sprocket ticks, and unit suffix are the (subtle) film cues.
import { useEffect, useId, useRef, type RefObject } from 'react';
import { cn } from '@/lib/utils';
import { useScrub } from '@/lib/useScrub';
import { useHoldRepeat } from '@/lib/useHoldRepeat';

const UNBOUNDED = Number.MAX_SAFE_INTEGER;

/** Pass as `min` for a field with no lower bound (the default lower bound is 0). */
export const NO_MIN = -UNBOUNDED;

interface NumberFieldProps {
  /** null shows an empty input (no value yet); steppers and scrub then start from 0. */
  value: number | null;
  onChange: (v: number) => void;
  /** Called when the viewer clears the input; without it a cleared input commits 0. */
  onEmpty?: () => void;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  'aria-label'?: string;
  id?: string;
  className?: string;
  inputCls?: string;
  compact?: boolean;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  'aria-required'?: boolean;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

interface MoveArgs {
  key: string;
  value: number;
  step: number;
  min: number;
  max: number;
}

// Keyboard niceties beyond the native ↑/↓: PageUp/Down = ±step×10, Home/End = min/max. Returns the
// next clamped value, or null when the key is none of ours (so native handling proceeds).
const resolveKeyMove = ({ key, value, step, min, max }: MoveArgs): number | null => {
  const big = step * 10;
  const moves: Record<string, number | undefined> = {
    PageUp: clamp(value + big, min, max),
    PageDown: clamp(value - big, min, max),
    Home: min === NO_MIN ? value : min,
    End: max === UNBOUNDED ? value : max,
  };

  return moves[key] ?? null;
};

// Quick value-slide WITHOUT remounting the input (a remount would drop focus): toggle a class on the
// live element and strip it on animationend. The global prefers-reduced-motion rule neutralises it.
const playTick = (el: HTMLInputElement) => {
  const clear = () => {
    el.classList.remove('take-counter-tick');
  };
  clear();
  el.getBoundingClientRect(); // reflow so re-adding the class restarts the keyframe
  el.classList.add('take-counter-tick');
  el.addEventListener('animationend', clear, { once: true });

  return () => {
    el.removeEventListener('animationend', clear);
  };
};

const useTick = (ref: RefObject<HTMLInputElement | null>, value: number) => {
  useEffect(() => {
    const el = ref.current;

    return el ? playTick(el) : undefined;
  }, [ref, value]);
};

const ariaFor = (ariaLabel: string | undefined, label: string | undefined, unit: string | undefined) => {
  if (ariaLabel) {
    return ariaLabel;
  }

  if (unit) {
    return `${label ?? ''} (${unit})`.trim();
  }

  return label;
};

const FieldLabel = ({ htmlFor, label }: { htmlFor: string; label: string | undefined }) => {
  if (!label) {
    return null;
  }

  return (
    <label htmlFor={htmlFor} className="block text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">
      {label}
    </label>
  );
};

interface StepperProps {
  dir: 'up' | 'down';
  label: string;
  onStep: () => void;
}

const Stepper = ({ dir, label, onStep }: StepperProps) => {
  const hold = useHoldRepeat(onStep);

  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      className="take-counter-step flex h-3.5 w-5 items-center justify-center text-[9px] leading-none text-gray-500 transition-colors hover:text-foreground"
      {...hold}
    >
      {dir === 'up' ? '▲' : '▼'}
    </button>
  );
};

interface AffordanceProps {
  unit: string | undefined;
  aria: string | undefined;
  step: number;
  onStep: (delta: number) => void;
}

// The film cues + ▲▼ steppers that decorate the editable input — all mouse/decorative, so the unit is
// aria-hidden (the input's value carries meaning) and the buttons are out of the tab order.
const CounterAffordances = ({ unit, aria, step, onStep }: AffordanceProps) => (
  <>
    {unit ? (
      <span aria-hidden className="take-counter-unit">
        {unit}
      </span>
    ) : null}
    <span className="take-counter-steps">
      <Stepper
        dir="up"
        label={`+${step} ${aria ?? ''}`.trim()}
        onStep={() => {
          onStep(step);
        }}
      />
      <Stepper
        dir="down"
        label={`-${step} ${aria ?? ''}`.trim()}
        onStep={() => {
          onStep(-step);
        }}
      />
    </span>
  </>
);

export const NumberField = ({
  value: shown,
  onChange,
  onEmpty,
  label,
  min = 0,
  max = UNBOUNDED,
  step = 1,
  unit,
  id,
  className,
  inputCls,
  compact = false,
  'aria-label': ariaLabel,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
  'aria-required': ariaRequired,
}: NumberFieldProps) => {
  const value = shown ?? 0;
  const autoId = useId();
  const fieldId = id ?? autoId;
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = (next: number) => {
    onChange(clamp(next, min, max));
  };
  const scrub = useScrub({ value, onChange: commit, step, min, max });
  useTick(inputRef, value);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const next = resolveKeyMove({ key: e.key, value, step, min, max });

    if (next === null) {
      return;
    }
    e.preventDefault();
    commit(next);
  };

  const resolvedAria = ariaFor(ariaLabel, label, unit);
  const maxAttr = max === UNBOUNDED ? undefined : max;
  const minAttr = min === NO_MIN ? undefined : min;

  return (
    <div className={className}>
      <FieldLabel htmlFor={fieldId} label={label} />
      <div
        className={cn('take-counter', compact && 'take-counter-compact')}
        data-scrubbing={scrub.scrubbing}
        onPointerDown={scrub.onPointerDown}
      >
        <input
          ref={inputRef}
          id={fieldId}
          type="number"
          inputMode="numeric"
          min={minAttr}
          max={maxAttr}
          step={step}
          value={shown ?? ''}
          aria-label={resolvedAria}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          aria-required={ariaRequired}
          onKeyDown={handleKeyDown}
          onChange={(e) => {
            if (e.target.value === '' && onEmpty) {
              onEmpty();

              return;
            }

            commit(Number(e.target.value));
          }}
          className={cn(
            'take-counter-input field-focus-gradient [--field-fill:var(--color-surface-inset)] bg-surface-inset',
            inputCls
          )}
        />
        <CounterAffordances
          unit={unit}
          aria={resolvedAria}
          step={step}
          onStep={(delta) => {
            commit(value + delta);
          }}
        />
      </div>
    </div>
  );
};
