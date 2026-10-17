// The LeClap video player, as plain functions: the clock it prints, where a pointer or a key seeks to, which keys
// drive it, the speed ladder, when its controls hide, and how it goes fullscreen. Every player in the app (the
// render result, the landing films, the showcase) reads these, so they all behave alike.

const pad = (value: number): string => String(value).padStart(2, '0');

/** "m:ss" (or "h:mm:ss" past the hour); an unknown or negative time reads as 0:00. */
export function formatClock(seconds: number): string {
  const whole = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;

  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(secs)}`;

  return `${minutes}:${pad(secs)}`;
}

const clamp = (value: number, max: number): number => Math.min(max, Math.max(0, value));

/** The share of `whole` that `part` is, clamped to 0–1; zero while the whole is unknown. */
export function fraction(part: number, whole: number): number {
  if (!(whole > 0)) return 0;

  return Math.min(1, Math.max(0, part / whole));
}

/** The time under a pointer at `clientX` on a track spanning `left` to `left + width`. */
export function pointerTime(clientX: number, track: { left: number; width: number }, duration: number): number {
  if (track.width <= 0) return 0;

  return clamp(((clientX - track.left) / track.width) * duration, duration);
}

const ARROW_STEP = 5;
const PAGE_FRACTION = 0.1;

/** Where a key on the seek slider goes, or null for a key the slider leaves alone. */
export function keySeekTarget(key: string, current: number, duration: number): number | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp': {
      return clamp(current + ARROW_STEP, duration);
    }
    case 'ArrowLeft':
    case 'ArrowDown': {
      return clamp(current - ARROW_STEP, duration);
    }
    case 'PageUp': {
      return clamp(current + duration * PAGE_FRACTION, duration);
    }
    case 'PageDown': {
      return clamp(current - duration * PAGE_FRACTION, duration);
    }
    case 'Home': {
      return 0;
    }
    case 'End': {
      return duration;
    }
    default: {
      return null;
    }
  }
}

/** The speeds the player offers, slowest first. */
export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/** The next speed up (1) or down (-1) the ladder, staying put at either end. */
export function stepRate(current: number, direction: 1 | -1): number {
  if (direction === 1) return PLAYBACK_RATES.find((rate) => rate > current) ?? PLAYBACK_RATES.at(-1) ?? 1;

  return PLAYBACK_RATES.findLast((rate) => rate < current) ?? PLAYBACK_RATES[0];
}

/** "1×", "0.75×", "1.5×". */
export const formatRate = (rate: number): string => `${rate}×`;

/** A speed read back from storage: one of the ladder's, or normal speed. */
export function readRate(stored: string | null): number {
  const rate = Number(stored);

  return PLAYBACK_RATES.find((step) => step === rate) ?? 1;
}

export type PlayerAction =
  | { type: 'toggle' }
  | { type: 'seekBy'; seconds: number }
  | { type: 'seekTo'; fraction: number }
  | { type: 'volumeBy'; delta: number }
  | { type: 'mute' }
  | { type: 'fullscreen' }
  | { type: 'captions' }
  | { type: 'pip' }
  | { type: 'rate'; direction: 1 | -1 };

/** What a key press landed on: enough to tell a field, a button, a slider or a menu apart. */
export interface KeyTarget {
  tag: string;
  role?: string | null;
  editable?: boolean;
}

export interface PlayerKey {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  target?: KeyTarget;
}

const FIELD_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const PRESS_KEYS = new Set([' ', 'Enter']);
const NAVIGATION_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);
const MENU_ROLES = new Set(['menu', 'menuitem', 'menuitemradio', 'menuitemcheckbox']);

function buttonTarget(target: KeyTarget): boolean {
  return target.tag === 'BUTTON' || target.tag === 'A' || target.role === 'button';
}

// Keys the focused control answers itself: typing in a field, every key in a menu (its letters jump to an item), a
// button's own press, a slider's arrows.
function ownedByTarget(key: string, target: KeyTarget | undefined): boolean {
  if (!target) return false;

  if (FIELD_TAGS.has(target.tag) || target.editable || MENU_ROLES.has(target.role ?? '')) return true;

  if (PRESS_KEYS.has(key) && buttonTarget(target)) return true;

  return NAVIGATION_KEYS.has(key) && target.role === 'slider';
}

const KEY_ACTIONS = new Map<string, PlayerAction>([
  [' ', { type: 'toggle' }],
  ['k', { type: 'toggle' }],
  ['ArrowLeft', { type: 'seekBy', seconds: -ARROW_STEP }],
  ['ArrowRight', { type: 'seekBy', seconds: ARROW_STEP }],
  ['j', { type: 'seekBy', seconds: -10 }],
  ['l', { type: 'seekBy', seconds: 10 }],
  ['ArrowUp', { type: 'volumeBy', delta: 0.1 }],
  ['ArrowDown', { type: 'volumeBy', delta: -0.1 }],
  ['Home', { type: 'seekTo', fraction: 0 }],
  ['End', { type: 'seekTo', fraction: 1 }],
  ['m', { type: 'mute' }],
  ['f', { type: 'fullscreen' }],
  ['c', { type: 'captions' }],
  ['p', { type: 'pip' }],
  ['<', { type: 'rate', direction: -1 }],
  ['>', { type: 'rate', direction: 1 }],
]);

/**
 * The player's keyboard: space/k play and pause, ←/→ step 5 s and j/l 10 s, ↑/↓ the volume, 0–9 a tenth of the film,
 * Home/End its ends, m mute, f fullscreen, c captions, p picture-in-picture, </> the speed. Browser shortcuts (⌘, Ctrl, Alt) and keys the
 * focused control answers itself are left alone. Null when the player has nothing to do.
 */
export function playerKeyAction({ key, ctrlKey, metaKey, altKey, target }: PlayerKey): PlayerAction | null {
  if (ctrlKey || metaKey || altKey) return null;

  if (ownedByTarget(key, target)) return null;

  if (/^\d$/.test(key)) return { type: 'seekTo', fraction: Number(key) / 10 };

  const normalised = key.length === 1 ? key.toLowerCase() : key;

  return KEY_ACTIONS.get(normalised) ?? KEY_ACTIONS.get(key) ?? null;
}

export interface ChromeState {
  /** The film is playing. */
  playing: boolean;
  /** The pointer has been still (or gone) for a while. */
  idle: boolean;
  /** A keyboard visitor's focus is inside the controls. */
  keyboardFocus: boolean;
  /** The speed or more menu is open. */
  menuOpen: boolean;
  /** The seek bar is being dragged. */
  scrubbing: boolean;
  /** Loading or failed: the visitor needs to see what is going on. */
  blocked: boolean;
  /** A mouse rests on the controls (reading the time, a scrub preview open). */
  onControls?: boolean;
}

/** Whether the controls show: always, except over a playing film nobody is touching. */
export function controlsShown(state: ChromeState): boolean {
  if (!state.playing || state.blocked) return true;

  return !state.idle || state.keyboardFocus || state.menuOpen || state.scrubbing || state.onControls === true;
}

/** How long a playing film waits for the pointer before its controls fade. */
export const IDLE_MS = 2500;

export interface FullscreenSupport {
  /** The player is fullscreen now. */
  active: boolean;
  /** The Fullscreen API can take the player's own frame, controls and all. */
  containerSupported: boolean;
  /** Only the video can go fullscreen, natively (iOS Safari's `webkitEnterFullscreen`). */
  videoSupported: boolean;
}

export type FullscreenPlan = 'exit' | 'container' | 'video' | 'none';

/** What the fullscreen button does: leave, take the whole player, or fall back to the bare video. */
export function fullscreenPlan({ active, containerSupported, videoSupported }: FullscreenSupport): FullscreenPlan {
  if (active) return 'exit';

  if (containerSupported) return 'container';

  if (videoSupported) return 'video';

  return 'none';
}
