import { describe, expect, it } from 'vitest';
import { suspendSmoothScroll } from './route-scroll';

type FakeRoot = { style: { scrollBehavior: string } };

// Stands in for window: records the inline value each time a style read forces a recalc.
function fakeView(root: FakeRoot) {
  const flushedWith: string[] = [];

  return {
    flushedWith,
    getComputedStyle: (element: unknown) => {
      expect(element).toBe(root);
      const value = root.style.scrollBehavior;

      return {
        getPropertyValue: () => {
          flushedWith.push(value);

          return value || 'smooth';
        },
      };
    },
  };
}

describe('suspendSmoothScroll', () => {
  it('switches the root to auto and forces the style recalc before any route scroll reads it', () => {
    // Chrome resolves a scrollTo's behavior from the last computed style: without the recalc, the
    // router's reset still reads `smooth` and glides through the page it just left.
    const root: FakeRoot = { style: { scrollBehavior: '' } };
    const view = fakeView(root);

    suspendSmoothScroll(root as unknown as HTMLElement, view as unknown as Window);

    expect(root.style.scrollBehavior).toBe('auto');
    expect(view.flushedWith).toEqual(['auto']);
  });

  it('hands smooth anchors back to the stylesheet on resume', () => {
    const root: FakeRoot = { style: { scrollBehavior: '' } };
    const view = fakeView(root);

    const resume = suspendSmoothScroll(root as unknown as HTMLElement, view as unknown as Window);
    resume();

    expect(root.style.scrollBehavior).toBe('');
  });
});
