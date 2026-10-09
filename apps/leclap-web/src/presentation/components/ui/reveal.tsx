import { useState, type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { useInView } from '@/hooks/useInView';
import type { RevealStagger } from '@/lib/reveal-stagger';

export interface RevealProps extends HTMLAttributes<HTMLDivElement> {
  /** Stagger delay in ms applied when the element enters the viewport. */
  delay?: number;
  /** Entrance direction (default 'up'). */
  from?: 'up' | 'down' | 'left' | 'right' | 'none';
  /** Add a subtle scale-up to the entrance (0.96 → 1), for cards that should "settle" into place. */
  scale?: boolean;
  /** Override the in-view trigger; both fall back to the useInView defaults when omitted. */
  threshold?: number;
  rootMargin?: string;
  /**
   * Shared by sibling Reveals (e.g. a grid's cards) so the ones entering together stagger: each takes its
   * slot's delay as it enters, on top of `delay`. Create it once per list with `createRevealStagger`.
   */
  stagger?: RevealStagger;
  /**
   * How an element already on screen as it mounts appears: 'enter' plays the full entrance (default);
   * 'fade' fades it in place, quickly and unstaggered — for content a visitor may land on mid-page, such as
   * a grid after a back navigation restores the scroll.
   */
  onScreen?: 'enter' | 'fade';
}

const HIDDEN = {
  up: 'opacity-0 translate-y-6',
  down: 'opacity-0 -translate-y-6',
  left: 'opacity-0 -translate-x-6',
  right: 'opacity-0 translate-x-6',
  none: 'opacity-0',
} as const;

interface RevealTrigger {
  threshold?: number;
  rootMargin?: string;
  stagger?: RevealStagger;
  onScreen: 'enter' | 'fade';
}

/**
 * When the element shows: once in view and, when staggered, once its batch has handed it a slot. `landed`
 * marks an element faded in place because it was already on screen as it mounted (`onScreen: 'fade'`).
 */
const useRevealTrigger = ({ threshold, rootMargin, stagger, onScreen }: RevealTrigger) => {
  const [staggerDelay, setStaggerDelay] = useState<number | null>(null);
  const [landed, setLanded] = useState(false);
  const [ref, entered] = useInView({
    threshold,
    rootMargin,
    onEnter: (element, mountedOnScreen) => {
      if (mountedOnScreen && onScreen === 'fade') {
        setLanded(true);

        return;
      }

      stagger?.enter(element, setStaggerDelay);
    },
  });
  const inView = entered && (landed || stagger === undefined || staggerDelay !== null);

  return { ref, inView, landed, staggerDelay: staggerDelay ?? 0 };
};

/**
 * Scroll-reveal wrapper: fades/rises its children in when they enter the viewport
 * (IntersectionObserver via {@link useInView}). Reduced-motion users see content immediately.
 */
export const Reveal = ({
  className,
  delay = 0,
  from = 'up',
  scale = false,
  threshold,
  rootMargin,
  stagger,
  onScreen = 'enter',
  style,
  children,
  ...props
}: RevealProps) => {
  const { ref, inView, landed, staggerDelay } = useRevealTrigger({ threshold, rootMargin, stagger, onScreen });

  return (
    <div
      ref={ref}
      className={cn(
        'transition-all duration-700 ease-[var(--ease-spring)]',
        'motion-reduce:transition-none motion-reduce:!translate-x-0 motion-reduce:!translate-y-0 motion-reduce:!scale-100 motion-reduce:!opacity-100',
        // will-change only while hidden so the entrance is hinted; once revealed the element is
        // static, so we drop the hint and free its compositor layer (avoids scroll jank when many
        // Reveals are on a page).
        inView
          ? cn('translate-x-0 translate-y-0 opacity-100', scale && 'scale-100')
          : cn(HIDDEN[from], scale && 'scale-[0.96]', 'will-change-[transform,opacity]'),
        className,
        // Landed on: the transform snaps into place and only the opacity fades, briefly.
        landed && 'transition-opacity duration-150 ease-out'
      )}
      style={{ transitionDelay: inView && !landed ? `${delay + staggerDelay}ms` : '0ms', ...style }}
      {...props}
    >
      {children}
    </div>
  );
};
