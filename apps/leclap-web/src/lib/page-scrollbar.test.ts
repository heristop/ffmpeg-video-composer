import { describe, expect, it } from 'vitest';
import { watchPageScrollbar } from './page-scrollbar';

function fakePage(innerWidth: number, rootWidth: number) {
  const props = new Map<string, string>();
  const locked = { value: false };
  const observer = { callback: (): void => {}, observing: false };
  const doc = {
    documentElement: {
      width: rootWidth,
      getBoundingClientRect() {
        return { width: this.width };
      },
      style: { setProperty: (name: string, value: string) => props.set(name, value) },
    },
    body: { hasAttribute: (name: string) => name === 'data-scroll-locked' && locked.value },
  };
  const win = {
    innerWidth,
    ResizeObserver: class {
      constructor(callback: () => void) {
        observer.callback = callback;
      }

      observe(): void {
        observer.observing = true;
      }

      disconnect(): void {
        observer.observing = false;
      }
    },
  };

  return { doc, win, props, locked, observer };
}

describe('watchPageScrollbar', () => {
  it('records the reserved scrollbar width (the root box, which clientWidth does not shrink for an empty gutter)', () => {
    const page = fakePage(1280, 1271);

    watchPageScrollbar(page.doc as never, page.win as never);

    expect(page.props.get('--page-scrollbar-width')).toBe('9px');
  });

  it('measures again when the root resizes (the stylesheet lands, the window resizes)', () => {
    const page = fakePage(1280, 1280);
    watchPageScrollbar(page.doc as never, page.win as never);
    expect(page.props.get('--page-scrollbar-width')).toBe('0px');

    page.doc.documentElement.width = 1271;
    page.observer.callback();

    expect(page.props.get('--page-scrollbar-width')).toBe('9px');
  });

  it('keeps the last width while a modal has removed the scrollbar', () => {
    const page = fakePage(1280, 1271);
    watchPageScrollbar(page.doc as never, page.win as never);

    page.locked.value = true;
    page.doc.documentElement.width = 1280;
    page.observer.callback();

    expect(page.props.get('--page-scrollbar-width')).toBe('9px');
  });

  it('stops observing when disposed', () => {
    const page = fakePage(1280, 1271);
    const dispose = watchPageScrollbar(page.doc as never, page.win as never);

    dispose();

    expect(page.observer.observing).toBe(false);
  });
});
