// The page scrollbar's width, kept as `--page-scrollbar-width` on the root. While a modal locks scrolling the
// page drops its reserved scrollbar gutter (index.css), so no bright strip shows beside the dimmed overlay;
// the body is then offset by this width so nothing behind the overlay moves.
export function watchPageScrollbar(doc: Document = document, win: typeof globalThis = window): () => void {
  const root = doc.documentElement;
  const measure = (): void => {
    // A locked page has no scrollbar to measure: keep the last width.
    if (doc.body.hasAttribute('data-scroll-locked')) return;

    // The root's box, not clientWidth: an empty reserved gutter shrinks the box but not clientWidth.
    root.style.setProperty('--page-scrollbar-width', `${win.innerWidth - root.getBoundingClientRect().width}px`);
  };
  // The root's box changes width when the stylesheet reserves the gutter and when the window resizes.
  const observer = new win.ResizeObserver(measure);

  measure();
  observer.observe(root);

  return () => {
    observer.disconnect();
  };
}
