import { useEffect, useRef, type RefObject } from 'react';
import { subscribe } from '@/lib/ticker';
import { CHEER_SECONDS } from '@/presentation/components/clappy/clappy.logic';
import {
  inlineTrack,
  milestoneReached,
  pinnedTrack,
  renderReadout,
  screenClappyFrame,
  settled,
  trackProgress,
  type RenderReadout,
  type RenderStage,
  type ScreenClappyFrame,
} from './render-screen.logic';

// The render screen's driver, on the landing's one frame loop (lib/ticker.ts) rather than a loop of its own:
// subscribed only while the screen shows, its phone is on screen, the tab is visible and motion is allowed. A scroll only marks the position stale; the next frame
// reads it once (one layout read, before any write), then writes the count, the stage line and the bar
// straight into the DOM — text nodes and a transform, so React never re-renders for the scroll. Clappy's pose
// goes to a small store his drawing subscribes to, stepped at 30 fps like every Clappy on the site. Once the
// finishing cheer has settled nothing moves, so it unsubscribes until the next scroll.

/** A pose store Clappy's drawing reads with useSyncExternalStore. */
export interface FrameStore {
  get: () => ScreenClappyFrame;
  set: (frame: ScreenClappyFrame) => void;
  subscribe: (listener: () => void) => () => void;
}

export const createFrameStore = (initial: ScreenClappyFrame): FrameStore => {
  let frame = initial;
  const listeners = new Set<() => void>();

  return {
    get: () => frame,
    set: (next) => {
      frame = next;

      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
};

/** How the screen words its readout, in the visitor's language. */
export interface ScreenLines {
  percent: (percent: number) => string;
  stage: (stage: RenderStage) => string;
}

interface ScrubState {
  /** The progress last applied; negative right after a start, so the first reading never cheers. */
  progress: number;
  shown: RenderReadout;
  /** Seconds the loop has run, paused with it. */
  clock: number;
  cheerAt: number | null;
  finishAt: number | null;
  /** The 30 fps step last published. */
  step: number;
}

const FPS = 30;

interface Parts {
  root: HTMLElement;
  percent: HTMLElement | null;
  stage: HTMLElement | null;
  bar: HTMLElement | null;
}

const partsOf = (root: HTMLElement): Parts => ({
  root,
  percent: root.querySelector<HTMLElement>('[data-scrub="percent"]'),
  stage: root.querySelector<HTMLElement>('[data-scrub="stage"]'),
  bar: root.querySelector<HTMLElement>('[data-scrub="bar"]'),
});

/**
 * Puts a fresh text node in: a centred line whose own text node changed width would count as a layout shift,
 * a new one does not. React's node goes with it, so the screen keys these elements on what React renders in
 * them (render-screen.tsx), and a change there remounts them instead of writing to a detached node.
 */
const setText = (element: HTMLElement | null, text: string): void => {
  element?.replaceChildren(text);
};

const measure = (root: HTMLElement, anchor: HTMLElement | null): number => {
  const viewport = globalThis.innerHeight;

  if (anchor) {
    const { top } = anchor.getBoundingClientRect();
    const row = anchor.parentElement?.offsetHeight ?? anchor.offsetHeight;

    return trackProgress(pinnedTrack({ top, row }, viewport));
  }

  const { top, height } = root.getBoundingClientRect();

  return trackProgress(inlineTrack({ top, height }, viewport));
};

const write = (parts: Parts, lines: ScreenLines, readout: RenderReadout, shown: RenderReadout): void => {
  if (readout.percent !== shown.percent) setText(parts.percent, lines.percent(readout.percent));

  if (readout.stage !== shown.stage) setText(parts.stage, lines.stage(readout.stage));

  if (readout.done !== shown.done) parts.root.toggleAttribute('data-done', readout.done);
};

/** Applies a fresh reading: the DOM, then the cheers it calls for. */
const advance = (state: ScrubState, parts: Parts, lines: ScreenLines, progress: number): void => {
  const previous = state.progress;
  const readout = renderReadout(progress);

  if (parts.bar) parts.bar.style.transform = `scaleX(${progress.toFixed(4)})`;

  write(parts, lines, readout, state.shown);
  state.shown = readout;
  state.progress = progress;

  if (!readout.done) {
    state.finishAt = null;

    if (previous >= 0 && milestoneReached(previous, progress)) state.cheerAt = state.clock;

    return;
  }

  // Arriving on a finished render (a restart, a jump) shows it settled; reaching it plays the cheer.
  state.finishAt ??= previous < 0 ? state.clock - CHEER_SECONDS : state.clock;
};

const since = (clock: number, moment: number | null): number | null =>
  moment === null ? null : Math.floor((clock - moment) * FPS) / FPS;

export interface RenderScrubOptions {
  screen: RefObject<HTMLElement | null>;
  /** The pinned phone's chapter text; null measures the screen itself (a phone inside the chapter). */
  anchor: RefObject<HTMLElement | null> | null;
  running: boolean;
  lines: ScreenLines;
  store: FrameStore;
  initial: RenderReadout;
}

export const useRenderScrub = ({ screen, anchor, running, lines, store, initial }: RenderScrubOptions): void => {
  const state = useRef<ScrubState>({ progress: -1, shown: initial, clock: 0, cheerAt: null, finishAt: null, step: -1 });

  useEffect(() => {
    const root = screen.current;

    if (!root || !running) return () => {};

    const parts = partsOf(root);
    const current = state.current;
    let unsubscribe: (() => void) | null = null;
    let last: number | undefined;
    let stale = true;

    current.progress = -1;

    const publish = () => {
      const step = Math.floor(current.clock * FPS);

      if (step === current.step) return;

      current.step = step;
      store.set(
        screenClappyFrame({
          run: step / FPS,
          cheer: since(current.clock, current.cheerAt),
          finish: since(current.clock, current.finishAt),
        })
      );
    };

    const rest = () => {
      unsubscribe?.();
      unsubscribe = null;
      last = undefined;
    };

    const tick = (now: number) => {
      current.clock += last === undefined ? 0 : Math.min(0.1, (now - last) / 1000);
      last = now;

      if (stale) {
        stale = false;
        advance(current, parts, lines, measure(root, anchor?.current ?? null));
      }

      publish();

      if (settled(since(current.clock, current.finishAt))) rest();
    };

    const schedule = () => {
      if (unsubscribe === null && !document.hidden) unsubscribe = subscribe(tick);
    };

    const onScroll = () => {
      stale = true;
      schedule();
    };

    const onVisibility = () => {
      if (document.hidden) {
        rest();

        return;
      }

      schedule();
    };

    globalThis.addEventListener('scroll', onScroll, { passive: true });
    globalThis.addEventListener('resize', onScroll, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    schedule();

    return () => {
      rest();
      globalThis.removeEventListener('scroll', onScroll);
      globalThis.removeEventListener('resize', onScroll);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [screen, anchor, running, lines, store]);
};
