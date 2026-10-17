import { forwardRef, type ReactNode } from 'react';
import { motion, useReducedMotion, type HTMLMotionProps } from 'motion/react';
import type { HapticInput } from 'web-haptics';
import { cn } from '@/lib/utils';
import { haptic as fireHaptic } from '@/lib/haptics';
import { kineticMotion } from './motion';

export interface PressableScaleProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  children: ReactNode;
  /** Scale dip on press (default 0.96). */
  scaleTo?: number;
  /** Subtle lift on hover (fine pointers). */
  hoverLift?: boolean;
  /** Haptic pattern fired on press; pass null to silence. */
  haptic?: HapticInput | null;
}

// Outcome patterns describe how an action RESOLVED, so they belong on the commit (click). Everything
// else — 'selection' and friends — describes the press itself and must fire on pointer-DOWN, on the
// same frame as the scale dip. Fired on click, a press haptic lags its own visual by the whole length
// of the press, and the two stop reading as one event.
const OUTCOME_HAPTICS = new Set(['success', 'warning', 'error', 'notification']);

const firesOnCommit = (input: HapticInput): boolean => typeof input === 'string' && OUTCOME_HAPTICS.has(input);

function motionFeedback(reduced: boolean | null, disabled: boolean | undefined, hoverLift: boolean, scaleTo: number) {
  return {
    whileTap: reduced || disabled ? undefined : { scale: scaleTo },
    whileHover: reduced || disabled || !hoverLift ? undefined : { y: -2 },
  };
}

// Tactile tap for anything that isn't a full Button — CTAs, tiles, chips. Dips on press with the
// shared `tap` spring and fires a best-effort haptic, so the surface has native "give". Renders a
// real <button> for accessibility. Honours reduced-motion (no scale/lift). Forwards its ref to the
// underlying <button> so adopters can wire roving-tabindex focus, drag handles or popover anchors.
export const PressableScale = forwardRef<HTMLButtonElement, PressableScaleProps>(function PressableScale(
  {
    children,
    scaleTo = 0.96,
    hoverLift = false,
    haptic = 'selection',
    className,
    onClick,
    onPointerDown,
    disabled,
    type = 'button',
    ...props
  },
  ref
) {
  const reduced = useReducedMotion();
  const onCommit = haptic !== null && firesOnCommit(haptic);
  const feedback = motionFeedback(reduced, disabled, hoverLift, scaleTo);

  // Press feedback rides pointer-down so the buzz and the scale dip land on the same frame.
  const handlePointerDown: PressableScaleProps['onPointerDown'] = (event) => {
    if (haptic && !onCommit && !disabled) fireHaptic(haptic);

    onPointerDown?.(event);
  };

  // Outcome feedback waits for the commit — and still reaches keyboard users, who never send a
  // pointer event at all.
  const handleClick: PressableScaleProps['onClick'] = (event) => {
    if (haptic && onCommit) fireHaptic(haptic);

    onClick?.(event);
  };

  return (
    <motion.button
      ref={ref}
      type={type}
      disabled={disabled}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      className={cn('touch-manipulation', className)}
      {...feedback}
      transition={kineticMotion.spring.tap}
      {...props}
    >
      {children}
    </motion.button>
  );
});

export default PressableScale;
