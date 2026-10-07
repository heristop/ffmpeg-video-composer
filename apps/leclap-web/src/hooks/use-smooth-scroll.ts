import { useLayoutEffect } from 'react';
import Lenis from 'lenis';
import { subscribe } from '@/lib/ticker';

// The marketing surface — the only places eased scrolling is mounted. An allowlist rather than a
// "/studio" denylist: the editor, builder, admin and doc routes all own scroll containers of their
// own, and a page that forgets to opt out should get native scrolling, not a fight.
const MARKETING_PATHS = new Set(['/', '/about', '/compare/remotion', '/legal', '/privacy']);

// How far the eased position travels toward the target each frame. Low enough to read as weight,
// high enough that the film scrub never feels like it lags the wheel.
const LERP = 0.085;

function prefers(query: string): boolean {
  return typeof globalThis.matchMedia === 'function' && globalThis.matchMedia(query).matches;
}

export function isSmoothScrollRoute(pathname: string): boolean {
  return MARKETING_PATHS.has(pathname);
}

/**
 * Mounts one Lenis instance for the landing and static marketing pages, driven by the shared ticker
 * rather than a loop of its own — so eased scrolling, the hero parallax and the film scrub all read
 * the same frame.
 *
 * Left off entirely (Lenis never constructed) under reduced motion and on coarse pointers, where the
 * platform's own inertia is better than anything we'd impose on top of it.
 *
 * A layout effect, not a passive one: React Router resets the scroll in a layout effect, and a Lenis
 * torn down only in the passive phase is still easing toward the landing's position for the frames in
 * between — its next tick writes that position back onto the page just opened, which then lands
 * mid-page. Torn down here, it is gone before the reset (layout cleanups all run before any layout
 * effect mounts), and the next route's instance starts from the scroll the router settled on.
 */
export function useSmoothScroll(pathname: string): void {
  useLayoutEffect(() => {
    if (!isSmoothScrollRoute(pathname)) return () => {};

    if (prefers('(prefers-reduced-motion: reduce)') || prefers('(pointer: coarse)')) return () => {};

    const lenis = new Lenis({
      lerp: LERP,
      // The shared ticker owns the frame; Lenis must not start a second loop.
      autoRaf: false,
      // Let Lenis ease in-page anchor jumps (the skip link, footer links) instead of the native
      // `scroll-behavior: smooth` it suppresses.
      anchors: true,
      // Nested scrollers (code blocks, overflow panels) keep their own scrolling.
      allowNestedScroll: true,
    });

    const unsubscribe = subscribe((time) => {
      lenis.raf(time);
    });

    return () => {
      unsubscribe();
      lenis.destroy();
    };
  }, [pathname]);
}
