// Press-and-hold auto-repeat for stepper buttons: fire once on press, then after a short delay
// repeat on an interval until release/leave. Returns handlers to spread onto the button.
import { useEffect, useRef } from 'react';

const HOLD_DELAY_MS = 350;
const REPEAT_MS = 60;

export const useHoldRepeat = (action: () => void) => {
  const actionRef = useRef(action);
  const delayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    actionRef.current = action;
  }, [action]);

  const stop = () => {
    if (delayRef.current) {
      clearTimeout(delayRef.current);
      delayRef.current = null;
    }

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  useEffect(() => stop, []);

  const start = () => {
    stop();
    actionRef.current();
    delayRef.current = setTimeout(() => {
      intervalRef.current = setInterval(() => {
        actionRef.current();
      }, REPEAT_MS);
    }, HOLD_DELAY_MS);
  };

  return { onPointerDown: start, onPointerUp: stop, onPointerLeave: stop };
};
