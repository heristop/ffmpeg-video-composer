import type { KeyboardEvent } from 'react';
import { playerKeyAction, type KeyTarget, type PlayerAction } from './player.logic';

// Wiring the player's keyboard (player.logic.ts) to a player's own actions.

export interface PlayerHandlers {
  toggle: () => void;
  seekTo: (seconds: number) => void;
  volumeBy: (delta: number) => void;
  mute: () => void;
  fullscreen: () => void;
  /** Absent where the video has no captions: `c` then does nothing. */
  captions?: () => void;
  rate: (direction: 1 | -1) => void;
  /** Absent where the browser has no picture-in-picture: `p` then does nothing. */
  pip?: () => void;
}

interface Clock {
  current: number;
  duration: number;
}

const keyTarget = (target: EventTarget | null): KeyTarget | undefined => {
  if (!(target instanceof Element)) return undefined;

  return {
    tag: target.tagName,
    role: target.getAttribute('role'),
    editable: target instanceof HTMLElement && target.isContentEditable,
  };
};

const clampTime = (seconds: number, duration: number): number => Math.min(duration, Math.max(0, seconds));

/** Runs one keyboard action against a player. */
export function runPlayerAction(action: PlayerAction, handlers: PlayerHandlers, time: Clock): void {
  switch (action.type) {
    case 'toggle': {
      handlers.toggle();

      return;
    }
    case 'seekBy': {
      handlers.seekTo(clampTime(time.current + action.seconds, time.duration));

      return;
    }
    case 'seekTo': {
      handlers.seekTo(clampTime(time.duration * action.fraction, time.duration));

      return;
    }
    case 'volumeBy': {
      handlers.volumeBy(action.delta);

      return;
    }
    case 'mute': {
      handlers.mute();

      return;
    }
    case 'fullscreen': {
      handlers.fullscreen();

      return;
    }
    case 'captions': {
      handlers.captions?.();

      return;
    }
    case 'pip': {
      handlers.pip?.();

      return;
    }
    default: {
      handlers.rate(action.direction);
    }
  }
}

// A key for a control this video lacks (captions, picture-in-picture) is left to the page.
const unhandled = (action: PlayerAction, handlers: PlayerHandlers): boolean =>
  (action.type === 'captions' && !handlers.captions) || (action.type === 'pip' && !handlers.pip);

/** A frame's keydown: the player's shortcuts, for whatever has focus inside it. */
export function playerKeyDown(
  event: KeyboardEvent<HTMLElement> | globalThis.KeyboardEvent,
  handlers: PlayerHandlers,
  time: Clock
): void {
  if (event.defaultPrevented) return;

  const action = playerKeyAction({
    key: event.key,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    target: keyTarget(event.target),
  });

  if (!action || unhandled(action, handlers)) return;

  event.preventDefault();
  runPlayerAction(action, handlers, time);
}
