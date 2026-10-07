/**
 * Takes the root's `scroll-behavior: smooth` out of play for a route change's own scroll (the router's
 * reset to the top, or its restore on back/forward), and returns the call that hands it back.
 *
 * Setting the inline style is not enough on its own: Chrome resolves a `scrollTo`'s behavior from the
 * last computed style, and nothing recalculates it between this layout effect and the router's. The
 * reset then still reads `smooth` and glides through the new page from wherever the last one was left
 * (on a phone, with no Lenis on the root, the visitor lands mid-page or a few hundred px off a restored
 * position). Reading the computed value forces that recalc here, once per navigation.
 */
export function suspendSmoothScroll(root: HTMLElement, view: Window = window): () => void {
  root.style.scrollBehavior = 'auto';
  view.getComputedStyle(root).getPropertyValue('scroll-behavior');

  return () => {
    root.style.scrollBehavior = '';
  };
}
