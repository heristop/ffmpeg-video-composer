import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, AppState } from 'react-native';

interface MotionPreferences {
  reducedMotion: boolean;
  appActive: boolean;
}

// One pair of native subscriptions for the entire UI, including lists of pressable cards.
// Stay still until the asynchronous accessibility setting is known.
let snapshot: MotionPreferences = { reducedMotion: true, appActive: AppState.currentState === 'active' };
const listeners = new Set<() => void>();
let dispose: (() => void) | undefined;
let queryRevision = 0;

function update(next: MotionPreferences) {
  if (next.reducedMotion === snapshot.reducedMotion && next.appActive === snapshot.appActive) return;
  snapshot = next;

  for (const notify of listeners) notify();
}

function refreshReducedMotion() {
  const revision = ++queryRevision;
  AccessibilityInfo.isReduceMotionEnabled()
    .then((reducedMotion) => {
      if (revision === queryRevision) update({ ...snapshot, reducedMotion });
    })
    .catch(() => {});
}

function subscribe(notify: () => void) {
  listeners.add(notify);

  if (listeners.size === 1) {
    update({ reducedMotion: true, appActive: AppState.currentState === 'active' });
    const reduced = AccessibilityInfo.addEventListener('reduceMotionChanged', (reducedMotion) => {
      // A later event wins over an earlier in-flight query.
      queryRevision++;
      update({ ...snapshot, reducedMotion });
    });
    const app = AppState.addEventListener('change', (state) => {
      update({
        ...snapshot,
        appActive: state === 'active',
        reducedMotion: state === 'active' ? true : snapshot.reducedMotion,
      });

      if (state === 'active') refreshReducedMotion();
    });
    refreshReducedMotion();
    dispose = () => {
      queryRevision++;
      reduced.remove();
      app.remove();
    };
  }

  return () => {
    listeners.delete(notify);

    if (listeners.size === 0) {
      dispose?.();
      dispose = undefined;
    }
  };
}

const getSnapshot = () => snapshot;

/** Live system preference and foreground state; no polling or per-frame React updates. */
export function useMotionPreferences() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
