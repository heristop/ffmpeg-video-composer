import { useCallback, useEffect, useRef, useState } from 'react';

// Pointer-events drag-to-reorder for a horizontal lane — works with BOTH mouse and touch (native HTML5
// `draggable` fires nothing on touch). Two-step "carry then drop": while dragging, the picked-up card is
// lifted out of flow and glued to the pointer, a placeholder marks the drop slot, and the reorder is
// committed ONLY on release. Disambiguation so taps/scrolls still work:
//   • mouse: a press becomes a drag only after a few px of movement (a click still selects);
//   • touch: a press becomes a drag only after a short hold (a swipe still scrolls the lane) — once the
//     hold fires we suppress page scroll for the rest of the gesture.
// Cards are matched by a `data-reorder-index` attribute; the lane auto-scrolls near its edges.
const MOUSE_THRESHOLD = 5; // px of movement before a mouse press is treated as a drag
const TOUCH_HOLD_MS = 260; // hold time before a touch press is treated as a drag
const TOUCH_SLOP = 10; // px of pre-hold movement that cancels into a scroll instead
const EDGE = 56; // px from a lane edge that triggers auto-scroll
const EDGE_SPEED = 16; // px per animation frame

interface DragState {
  from: number;
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
  hold: number | null;
  over: number;
  edge: number;
  raf: number | null;
  el: HTMLElement | null;
  grabX: number;
  grabY: number;
}

// Pick the card up out of flow and glue it to the pointer (set on the element so following doesn't
// re-render each frame). `carry` moves it; `release` puts it back.
const grab = (el: HTMLElement, rect: DOMRect): void => {
  el.style.position = 'fixed';
  el.style.margin = '0';
  el.style.width = `${rect.width}px`;
  el.style.left = `${rect.left}px`;
  el.style.top = `${rect.top}px`;
  el.style.zIndex = '9999';
  el.style.pointerEvents = 'none';
  el.style.boxShadow = '0 18px 40px rgba(0,0,0,0.55)';
  el.style.transform = 'scale(1.04) rotate(1.5deg)';
  el.style.transition = 'box-shadow 0.15s ease';
};
const carry = (el: HTMLElement, x: number, y: number): void => {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
};
const release = (el: HTMLElement): void => {
  for (const prop of [
    'position',
    'margin',
    'width',
    'left',
    'top',
    'zIndex',
    'pointerEvents',
    'boxShadow',
    'transform',
    'transition',
  ]) {
    el.style.removeProperty(prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`));
  }
};

// The item index whose left half `clientX` sits in (its data-reorder-index), else the last item.
const itemIndexAt = (root: HTMLElement, clientX: number): number => {
  const items = [...root.querySelectorAll<HTMLElement>('[data-reorder-index]')];
  const hit = items.find((el) => {
    const rect = el.getBoundingClientRect();

    return clientX < rect.left + rect.width / 2;
  });

  if (hit) return Number(hit.dataset.reorderIndex);

  const last = items.at(-1);

  return last ? Number(last.dataset.reorderIndex) : 0;
};

// Auto-scroll direction at the lane edges: -1 left, +1 right, 0 inside.
const edgeDir = (clientX: number, rect: DOMRect): number => {
  if (clientX - rect.left < EDGE) return -1;

  if (rect.right - clientX < EDGE) return 1;

  return 0;
};

// After a real drag, swallow the one trailing click so it can't also select the card (which would change
// the preview). A plain tap never starts a drag, so it never reaches here.
const suppressNextClick = (): void => {
  const swallow = (click: Event): void => {
    click.stopPropagation();
    click.preventDefault();
    window.removeEventListener('click', swallow, true);
  };

  window.addEventListener('click', swallow, true);
  window.setTimeout(() => {
    window.removeEventListener('click', swallow, true);
  }, 350);
};

export interface PointerReorder {
  containerRef: React.RefObject<HTMLDivElement | null>;
  draggingIndex: number | null;
  overIndex: number | null;
  itemPointerDown: (index: number) => (event: React.PointerEvent) => void;
}

export const usePointerReorder = (onReorder: (from: number, to: number) => void): PointerReorder => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const state = useRef<DragState | null>(null);
  const onReorderRef = useRef(onReorder);
  const handlers = useRef<{ move: (e: PointerEvent) => void; up: (e: PointerEvent) => void }>({
    move: () => {},
    up: () => {},
  });

  useEffect(() => {
    onReorderRef.current = onReorder;
  }, [onReorder]);

  const preventScroll = useCallback((event: TouchEvent) => {
    event.preventDefault();
  }, []);

  const stopEdge = useCallback(() => {
    const s = state.current;

    if (!s || s.raf === null) return;

    cancelAnimationFrame(s.raf);
    s.raf = null;
  }, []);

  const tickEdge = useCallback(function tickEdge() {
    const root = containerRef.current;
    const s = state.current;

    if (!root || !s || s.edge === 0) {
      if (s) s.raf = null;

      return;
    }

    root.scrollLeft += s.edge * EDGE_SPEED;
    s.raf = requestAnimationFrame(tickEdge);
  }, []);

  const cleanup = useCallback(() => {
    const s = state.current;

    if (s && s.hold !== null) clearTimeout(s.hold);

    if (s?.el) release(s.el);

    stopEdge();
    document.removeEventListener('touchmove', preventScroll);
    window.removeEventListener('pointermove', handlers.current.move);
    window.removeEventListener('pointerup', handlers.current.up);
    window.removeEventListener('pointercancel', handlers.current.up);
    state.current = null;
    setDraggingIndex(null);
    setOverIndex(null);
  }, [preventScroll, stopEdge]);

  const begin = useCallback(() => {
    const s = state.current;

    if (!s || s.active) return;

    s.active = true;

    if (s.hold !== null) {
      clearTimeout(s.hold);
      s.hold = null;
    }

    s.el = containerRef.current?.querySelector<HTMLElement>(`[data-reorder-index="${s.from}"]`) ?? null;

    if (s.el) {
      const rect = s.el.getBoundingClientRect();
      s.grabX = s.startX - rect.left;
      s.grabY = s.startY - rect.top;
      grab(s.el, rect);
      carry(s.el, s.startX - s.grabX, s.startY - s.grabY);
    }

    setDraggingIndex(s.from);
    setOverIndex(s.from);
    // Hold fired (or the mouse moved past threshold) — own the gesture and stop the lane scrolling.
    document.addEventListener('touchmove', preventScroll, { passive: false });
  }, [preventScroll]);

  // Promote a press to a drag once the move/hold gate is passed; returns whether the drag is active.
  const tryActivate = useCallback(
    (s: DragState, event: PointerEvent): boolean => {
      if (s.active) return true;

      const dx = Math.abs(event.clientX - s.startX);
      const dy = Math.abs(event.clientY - s.startY);

      if (event.pointerType === 'mouse') {
        if (dx > MOUSE_THRESHOLD || dy > MOUSE_THRESHOLD) begin();

        return s.active;
      }

      if (dx > TOUCH_SLOP || dy > TOUCH_SLOP) cleanup(); // moved before the hold fired → it's a scroll

      return s.active;
    },
    [begin, cleanup]
  );

  const onMove = useCallback(
    (event: PointerEvent) => {
      const root = containerRef.current;
      const s = state.current;

      if (!root || !s || event.pointerId !== s.pointerId || !tryActivate(s, event)) return;

      event.preventDefault();

      // Carry the picked-up card with the pointer; the array is NOT reordered until release.
      if (s.el) carry(s.el, event.clientX - s.grabX, event.clientY - s.grabY);

      const over = itemIndexAt(root, event.clientX);

      if (over !== s.over) {
        s.over = over;
        setOverIndex(over);
      }

      const edge = edgeDir(event.clientX, root.getBoundingClientRect());

      if (edge !== s.edge) {
        s.edge = edge;
        stopEdge();

        if (edge !== 0) s.raf = requestAnimationFrame(tickEdge);
      }
    },
    [stopEdge, tickEdge, tryActivate]
  );

  const onUp = useCallback(
    (event: PointerEvent) => {
      const s = state.current;

      if (!s || event.pointerId !== s.pointerId) return;

      const wasDrag = s.active;

      if (s.active && s.over !== s.from) onReorderRef.current(s.from, s.over); // commit on drop

      cleanup();

      if (wasDrag) suppressNextClick();
    },
    [cleanup]
  );

  useEffect(() => {
    handlers.current = { move: onMove, up: onUp };
  }, [onMove, onUp]);

  const itemPointerDown = useCallback(
    (index: number) => (event: React.PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return; // primary mouse button only

      state.current = {
        from: index,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        hold: event.pointerType === 'mouse' ? null : window.setTimeout(begin, TOUCH_HOLD_MS),
        over: index,
        edge: 0,
        raf: null,
        el: null,
        grabX: 0,
        grabY: 0,
      };

      window.addEventListener('pointermove', handlers.current.move, { passive: false });
      window.addEventListener('pointerup', handlers.current.up);
      window.addEventListener('pointercancel', handlers.current.up);
    },
    [begin]
  );

  useEffect(() => cleanup, [cleanup]);

  return { containerRef, draggingIndex, overIndex, itemPointerDown };
};
