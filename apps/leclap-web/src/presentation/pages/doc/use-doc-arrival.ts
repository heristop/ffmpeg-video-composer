import { useLayoutEffect, useRef, type RefObject } from 'react';
import { useNavigationType } from 'react-router-dom';

// What happens as a doc page arrives.
//
// A deep link (`/doc/cli#render`, the Copy-page source URL, a shared "#" permalink) must land on its
// section: on a fresh load the router's scroll restoration looks for the anchor before this lazy route
// has rendered, finds nothing, and leaves the reader at the top of the page. So the jump is replayed
// here once the page exists — after the web font settles, since a late swap would reflow the target
// away. Back/forward is left alone: there the router restores where the reader actually was.
//
// Moving forward to another page starts it at the top at once. The router resets the scroll too, but
// html's `scroll-behavior: smooth` turns that reset into an 800ms rewind through the new page from
// wherever the last one was left. This runs as a layout effect, before the router's own (a child's
// layout effects run first), so the page is painted at the top and the router's reset has nothing left
// to animate.
//
// It also sends focus to the new page's title. The pager and the phone menu sit far from it: without
// this, a keyboard or screen-reader user stays parked at the bottom of a page that has already
// scrolled away beneath them. The first page of a visit keeps the browser's own focus start, so the
// skip link still comes first.
function arriveDoc(root: HTMLElement, previous: string | null, pathname: string, navigationType: string): void {
  const firstPage = previous === null;
  const pageChanged = !firstPage && previous !== pathname;
  const forward = pageChanged && navigationType !== 'POP';
  const { hash } = window.location;

  if (hash.length > 1) {
    if (!firstPage && !forward) return;

    const target = document.getElementById(hash.slice(1));
    const jump = () => {
      target?.scrollIntoView({ block: 'start', behavior: 'instant' });
    };

    document.fonts.ready.then(jump, jump);

    return;
  }

  if (!pageChanged) return;

  if (forward) window.scrollTo({ top: 0, behavior: 'instant' });

  const title = root.querySelector('h1');
  title?.setAttribute('tabindex', '-1');
  title?.focus({ preventScroll: true });
}

export function useDocArrival(contentRef: RefObject<HTMLElement | null>, pathname: string): void {
  // The page the last run saw. Comparing paths, not a "has run" flag, is what keeps a re-run on the
  // same page — StrictMode's double mount, a navigation-type change — from reading as an arrival.
  const lastPath = useRef<string | null>(null);
  const navigationType = useNavigationType();

  useLayoutEffect(() => {
    const root = contentRef.current;
    const previous = lastPath.current;

    lastPath.current = pathname;

    if (root) arriveDoc(root, previous, pathname, navigationType);
  }, [contentRef, pathname, navigationType]);
}
