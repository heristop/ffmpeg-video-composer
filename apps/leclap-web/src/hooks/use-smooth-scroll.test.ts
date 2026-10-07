import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The web suite has no DOM renderer, so React's effect hooks are captured instead of run: the test then
// plays the commit itself. What matters is the phase. React Router resets the scroll in a layout effect;
// a Lenis torn down any later (a passive effect) is still alive for the frames in between, and its next
// tick writes the landing's position back onto the page just navigated to.
const hooks = vi.hoisted(() => ({
  layout: [] as Array<() => () => void>,
  passive: [] as Array<() => () => void>,
}));

vi.mock('react', () => ({
  useLayoutEffect: (effect: () => () => void) => {
    hooks.layout.push(effect);
  },
  useEffect: (effect: () => () => void) => {
    hooks.passive.push(effect);
  },
}));

const lenis = vi.hoisted(() => ({ created: 0, destroyed: 0 }));

vi.mock('lenis', () => ({
  default: class {
    constructor() {
      lenis.created += 1;
    }

    raf() {}

    destroy() {
      lenis.destroyed += 1;
    }
  },
}));

vi.mock('@/lib/ticker', () => ({ subscribe: () => () => {} }));

const { useSmoothScroll, isSmoothScrollRoute } = await import('./use-smooth-scroll');

describe('useSmoothScroll', () => {
  beforeEach(() => {
    hooks.layout.length = 0;
    hooks.passive.length = 0;
    lenis.created = 0;
    lenis.destroyed = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mounts and tears Lenis down in the layout phase, so the route scroll reset runs on native scrolling', () => {
    useSmoothScroll('/');

    expect(hooks.passive).toHaveLength(0);
    expect(hooks.layout).toHaveLength(1);

    const cleanup = hooks.layout[0]();

    expect(lenis.created).toBe(1);

    cleanup();

    expect(lenis.destroyed).toBe(1);
  });

  it('leaves non-marketing routes on native scrolling', () => {
    useSmoothScroll('/showcase');
    hooks.layout[0]();

    expect(lenis.created).toBe(0);
  });

  it('stays off under reduced motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }));
    useSmoothScroll('/');
    hooks.layout[0]();

    expect(lenis.created).toBe(0);
  });

  it('eases the landing and static pages only', () => {
    expect(isSmoothScrollRoute('/')).toBe(true);
    expect(isSmoothScrollRoute('/about')).toBe(true);
    expect(isSmoothScrollRoute('/showcase')).toBe(false);
  });
});
