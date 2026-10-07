// The film player's seek bar, as plain functions: the clock it prints, where a key or a pointer seeks to.

const pad = (value: number): string => String(value).padStart(2, '0');

/** "m:ss" (or "h:mm:ss" past the hour); an unknown duration reads as 0:00. */
export function formatClock(seconds: number): string {
  const whole = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

const ARROW_STEP = 5;
const PAGE_FRACTION = 0.1;

const clamp = (value: number, max: number): number => Math.min(max, Math.max(0, value));

/** Where a key on the slider seeks to, or null for a key the slider leaves alone. */
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

/** The time under a pointer at `clientX` on a track spanning `left` to `left + width`. */
export function pointerTime(clientX: number, track: { left: number; width: number }, duration: number): number {
  if (track.width <= 0) return 0;

  return clamp(((clientX - track.left) / track.width) * duration, duration);
}
