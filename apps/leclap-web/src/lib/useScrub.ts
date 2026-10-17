// Drag-to-scrub a numeric field. The math lives in `scrubValue` (pure, unit-tested); the hook wires
// it to pointer events with a small movement threshold so a plain click still focuses the input.
import { useEffect, useRef, useState } from 'react';

export type ScrubModifier = 'fine' | 'coarse' | 'normal';

const DEFAULT_PX_PER_STEP = 6;
const MOVE_THRESHOLD_PX = 3;
const FINE_FACTOR = 0.25;
const COARSE_FACTOR = 4;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

const factorFor = (modifier: ScrubModifier) => {
  if (modifier === 'fine') {
    return FINE_FACTOR;
  }

  if (modifier === 'coarse') {
    return COARSE_FACTOR;
  }

  return 1;
};

interface ScrubMathArgs {
  start: number;
  deltaX: number;
  step: number;
  min: number;
  max: number;
  pxPerStep?: number;
  modifier?: ScrubModifier;
}

export const scrubValue = ({
  start,
  deltaX,
  step,
  min,
  max,
  pxPerStep = DEFAULT_PX_PER_STEP,
  modifier = 'normal',
}: ScrubMathArgs): number => {
  const factor = factorFor(modifier);
  const raw = start + (deltaX / pxPerStep) * step * factor;
  const snapped = Math.round(raw / step) * step;

  return clamp(snapped, min, max);
};

interface UseScrubArgs {
  value: number;
  onChange: (v: number) => void;
  step: number;
  min: number;
  max: number;
  pxPerStep?: number;
}

interface ScrubState {
  startX: number;
  startValue: number;
}

const modifierFromEvent = (e: PointerEvent): ScrubModifier => {
  if (e.shiftKey) {
    return 'fine';
  }

  if (e.altKey) {
    return 'coarse';
  }

  return 'normal';
};

export const useScrub = ({ value, onChange, step, min, max, pxPerStep }: UseScrubArgs) => {
  const [scrubbing, setScrubbing] = useState(false);
  const dragRef = useRef<ScrubState | null>(null);
  const movedRef = useRef(false);
  // Keep the latest callback + range in refs so the once-mounted window listeners never go stale.
  const cfgRef = useRef({ onChange, step, min, max, pxPerStep });

  useEffect(() => {
    cfgRef.current = { onChange, step, min, max, pxPerStep };
  }, [onChange, step, min, max, pxPerStep]);

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const drag = dragRef.current;

      if (!drag) {
        return;
      }
      const deltaX = e.clientX - drag.startX;

      if (!movedRef.current && Math.abs(deltaX) < MOVE_THRESHOLD_PX) {
        return;
      }
      movedRef.current = true;
      setScrubbing(true);
      const cfg = cfgRef.current;
      cfg.onChange(
        scrubValue({
          start: drag.startValue,
          deltaX,
          step: cfg.step,
          min: cfg.min,
          max: cfg.max,
          pxPerStep: cfg.pxPerStep,
          modifier: modifierFromEvent(e),
        })
      );
    };

    const handleUp = () => {
      dragRef.current = null;
      movedRef.current = false;
      setScrubbing(false);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);

    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX, startValue: value };
    movedRef.current = false;
  };

  return { onPointerDown, scrubbing };
};
