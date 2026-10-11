import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { IDLE_MS, controlsShown } from './player.logic';
import { playerKeyDown, type PlayerHandlers } from './player-keys';
import type { MediaState } from './use-media-state';

interface ChromeInput {
  playing: boolean;
  /** Loading or failed. */
  blocked: boolean;
  menuOpen: boolean;
  scrubbing: boolean;
  onControls: boolean;
}

/**
 * Whether the controls show. They fade over a playing film once the pointer has been still for IDLE_MS (or left
 * the frame), and come back on any pointer move, touch or keyboard focus. A menu, a drag on the seek bar, loading
 * or an error keep them up.
 */
export function usePlayerChrome({ playing, blocked, menuOpen, scrubbing, onControls }: ChromeInput) {
  const [idle, setIdle] = useState(true);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopTimer = () => {
    if (timer.current) clearTimeout(timer.current);
  };

  useEffect(() => stopTimer, []);

  const wake = () => {
    setIdle(false);
    stopTimer();
    timer.current = setTimeout(() => {
      setIdle(true);
    }, IDLE_MS);
  };

  const rest = () => {
    stopTimer();
    setIdle(true);
  };

  const onFocus = (event: FocusEvent<HTMLElement>) => {
    if (event.target.matches(':focus-visible')) setKeyboardFocus(true);
  };

  const onBlur = (event: FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget;

    if (next instanceof Node && event.currentTarget.contains(next)) return;

    setKeyboardFocus(false);
  };

  return {
    shown: controlsShown({ playing, idle, keyboardFocus, menuOpen, scrubbing, blocked, onControls }),
    wake,
    rest,
    onFocus,
    onBlur,
  };
}

export type PlayerChrome = ReturnType<typeof usePlayerChrome>;

/**
 * The frame's own props: a named region that wakes the controls on any pointer move, rests them when a mouse leaves,
 * answers the player's keys, and reports whether its controls show (`data-chrome`, read by index.css). `surfaceClick`
 * wraps the video's click: a tap over hidden controls only brings them back; a click, or a tap on shown controls,
 * plays or pauses.
 */
export function usePlayerFrame({
  title,
  chrome,
  fullscreen,
  onKey,
}: {
  title: string;
  chrome: PlayerChrome;
  fullscreen: boolean;
  onKey: (event: KeyboardEvent<HTMLElement>) => void;
}) {
  const lastPointer = useRef('mouse');

  const frameProps = {
    role: 'region',
    'aria-label': title,
    tabIndex: -1,
    'data-chrome': chrome.shown ? 'shown' : 'hidden',
    'data-fullscreen': fullscreen ? '' : undefined,
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      lastPointer.current = event.pointerType;
      chrome.wake();
    },
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      lastPointer.current = event.pointerType;
    },
    onPointerLeave: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === 'mouse') chrome.rest();
    },
    onKeyDown: onKey,
    onFocus: chrome.onFocus,
    onBlur: chrome.onBlur,
  };

  const surfaceClick = (toggle: () => void) => () => {
    if (lastPointer.current === 'touch' && !chrome.shown) {
      chrome.wake();

      return;
    }

    toggle();
  };

  return { frameProps, surfaceClick };
}

/**
 * Everything a player's chrome keeps: its menus and drags (which hold the controls up), the clap
 * (bumped each time the visitor starts the film, by a click, a tap or a key), and the frame's props with the
 * player's keyboard wired to `handlers`.
 */
export function usePlayerUi({
  title,
  media,
  fullscreen,
  handlers,
}: {
  title: string;
  media: MediaState;
  fullscreen: { active: boolean; toggle: () => void };
  handlers: PlayerHandlers;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [onControls, setOnControls] = useState(false);
  const [clap, setClap] = useState(0);
  const chrome = usePlayerChrome({
    playing: !media.paused,
    blocked: media.waiting || media.failed,
    menuOpen,
    scrubbing,
    onControls,
  });
  const toggle = () => {
    if (media.paused && !media.failed) setClap((count) => count + 1);

    handlers.toggle();
  };
  const onKey = (event: KeyboardEvent<HTMLElement> | globalThis.KeyboardEvent) => {
    chrome.wake();
    playerKeyDown(event, { ...handlers, toggle }, media);
  };
  const frame = usePlayerFrame({ title, chrome, fullscreen: fullscreen.active, onKey });

  return { ...frame, chrome, onKey, toggle, clap, setMenuOpen, setScrubbing, setOnControls };
}

export type PlayerUi = ReturnType<typeof usePlayerUi>;
