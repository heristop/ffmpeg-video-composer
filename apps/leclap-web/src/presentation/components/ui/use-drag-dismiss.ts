import { useRef, type PointerEvent } from 'react';

// Past this drag distance (px), or a downward flick faster than this (px/s) that has moved at least a
// little, releasing the handle dismisses the sheet; anything less springs it back open.
const CLOSE_OFFSET = 90;
const CLOSE_VELOCITY = 480;
const FLICK_MIN_OFFSET = 16;

export function shouldDismiss(offset: number, velocity: number): boolean {
  return offset > CLOSE_OFFSET || (velocity > CLOSE_VELOCITY && offset > FLICK_MIN_OFFSET);
}

interface DragStart {
  y: number;
  time: number;
  panel: HTMLElement;
}

// The panel follows the finger through `--sheet-drag` (read by `.sheet-panel[data-side='bottom']`), so
// the exit animation also starts from wherever the finger let go. `data-dragging` turns the snap-back
// transition off while the finger is down.
function setDrag(panel: HTMLElement, offset: number): void {
  panel.style.setProperty('--sheet-drag', `${String(offset)}px`);
}

export function useDragDismiss(onDismiss: () => void) {
  const start = useRef<DragStart | null>(null);

  const offsetOf = (event: PointerEvent): number => Math.max(0, event.clientY - (start.current?.y ?? event.clientY));

  const end = (event: PointerEvent, commit: boolean): void => {
    const drag = start.current;

    if (!drag) return;

    const offset = offsetOf(event);
    const seconds = Math.max(0.001, (event.timeStamp - drag.time) / 1000);
    start.current = null;
    delete drag.panel.dataset.dragging;

    if (commit && shouldDismiss(offset, offset / seconds)) {
      onDismiss();

      return;
    }
    setDrag(drag.panel, 0);
  };

  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      const panel = event.currentTarget.closest<HTMLElement>('.sheet-panel');

      if (!panel || event.button !== 0) return;

      event.currentTarget.setPointerCapture(event.pointerId);
      panel.dataset.dragging = '';
      start.current = { y: event.clientY, time: event.timeStamp, panel };
    },
    onPointerMove: (event: PointerEvent) => {
      if (start.current) setDrag(start.current.panel, offsetOf(event));
    },
    onPointerUp: (event: PointerEvent) => {
      end(event, true);
    },
    onPointerCancel: (event: PointerEvent) => {
      end(event, false);
    },
  };
}
