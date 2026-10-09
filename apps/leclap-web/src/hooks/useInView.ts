import { useEffect, useEffectEvent, useRef, useState, type RefObject } from 'react';

interface UseInViewOptions<T extends Element> {
  /** Fraction of the element visible before it counts as in-view (0..1). */
  threshold?: number;
  /** Reveal once then stop observing (default true). */
  once?: boolean;
  /** Margin around the root; the default reveals slightly before the element is fully on screen. */
  rootMargin?: string;
  /**
   * Called with the element as it enters the viewport, just before `inView` turns true. `onScreen` is set
   * when it was already in view on the observer's first report, i.e. on screen as it mounted.
   */
  onEnter?: (element: T, onScreen: boolean) => void;
}

/**
 * Observe an element and report when it scrolls into the viewport, via IntersectionObserver.
 * Falls back to immediately in-view when IntersectionObserver is unavailable.
 */
export function useInView<T extends Element = HTMLDivElement>({
  threshold = 0.1,
  once = true,
  // Positive bottom margin grows the observer root downward, so an element reveals a bit before it
  // reaches the fold (snappier on scroll-down). Keep the bottom margin positive — a negative one
  // would hide page-bottom elements that can't scroll any higher.
  rootMargin = '0px 0px 15% 0px',
  onEnter,
}: UseInViewOptions<T> = {}): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  const enter = useEffectEvent((element: T, onScreen: boolean) => {
    onEnter?.(element, onScreen);
    setInView(true);
  });

  useEffect(() => {
    const el = ref.current;

    if (!el) return () => {};

    if (typeof IntersectionObserver === 'undefined') {
      enter(el, true);

      return () => {};
    }

    // An observer's first report is the element's state as observing starts.
    let firstReport = true;
    const observer = new IntersectionObserver(
      (entries) => {
        const onScreen = firstReport;

        firstReport = false;

        for (const entry of entries) {
          if (entry.isIntersecting) {
            enter(el, onScreen);

            if (once) observer.unobserve(entry.target);
            continue;
          }

          if (!once) {
            setInView(false);
          }
        }
      },
      { threshold, rootMargin }
    );

    observer.observe(el);

    return () => {
      observer.disconnect();
    };
  }, [threshold, once, rootMargin]);

  return [ref, inView];
}
