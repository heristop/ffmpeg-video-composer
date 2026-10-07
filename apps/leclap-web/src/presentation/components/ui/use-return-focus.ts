import { useLayoutEffect, useRef } from 'react';

// What had focus when an overlay opened, handed back on close. Radix returns focus to its Trigger, but an
// overlay opened from state (a confirm after a card action, a sheet opened from a toolbar) has none, and
// focus fell to <body>. Read in a layout effect: it runs before Radix moves focus into the panel.
// `fallback` (a selector) names where focus goes when the opener is gone by then, e.g. an overlay
// opened from inside another overlay that it replaced.
export function useReturnFocus(onCloseAutoFocus?: (event: Event) => void, fallback?: string): (event: Event) => void {
  const returnTo = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const active = document.activeElement;
    returnTo.current = active instanceof HTMLElement && active !== document.body ? active : null;
  }, []);

  return (event: Event) => {
    onCloseAutoFocus?.(event);

    const opener = returnTo.current?.isConnected ? returnTo.current : null;
    const target = opener ?? (fallback ? document.querySelector<HTMLElement>(fallback) : null);

    if (event.defaultPrevented || !target?.isConnected) return;

    event.preventDefault();
    target.focus({ preventScroll: true });
  };
}
