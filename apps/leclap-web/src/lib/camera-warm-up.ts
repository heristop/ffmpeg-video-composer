import { useEffect } from 'react';

// The first getUserMedia of a page waits for the browser to enumerate its capture devices (camera and
// microphone discovery in the browser process), so the first camera open of a session sat on "Starting
// camera…" several times longer than every later one. enumerateDevices pays that same cost without
// opening the camera, lighting its LED or prompting for permission, so we run it once the user is on
// the way to recording: when the record entry shows up, and again on hover/focus/press of it.

let warmUp: Promise<void> | null = null;

export function warmUpCamera(): Promise<void> {
  if (warmUp) return warmUp;

  const mediaDevices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;

  if (typeof mediaDevices?.enumerateDevices !== 'function') {
    warmUp = Promise.resolve();

    return warmUp;
  }

  // Only the browser-side enumeration matters; the device list itself (unlabelled before permission) is dropped.
  warmUp = mediaDevices.enumerateDevices().then(
    () => {},
    () => {}
  );

  return warmUp;
}

// Fallback delay where requestIdleCallback is missing (Safari): late enough to stay out of the step's
// first paint, early enough to beat a click.
const IDLE_FALLBACK_MS = 300;

// Warm up when the main thread is next idle. Returns a cancel for when the record entry unmounts first.
export function scheduleCameraWarmUp(): () => void {
  const run = (): void => {
    warmUpCamera().catch(() => {});
  };

  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(run);

    return () => {
      cancelIdleCallback(id);
    };
  }

  const id = setTimeout(run, IDLE_FALLBACK_MS);

  return () => {
    clearTimeout(id);
  };
}

// Props for the button that opens the camera: hovering, focusing or pressing it is the intent signal.
export const cameraWarmUpIntentProps = {
  onPointerEnter: (): void => {
    warmUpCamera().catch(() => {});
  },
  onFocus: (): void => {
    warmUpCamera().catch(() => {});
  },
  onPointerDown: (): void => {
    warmUpCamera().catch(() => {});
  },
};

// For the component that offers the camera: warms up on idle while it is shown (and enabled), and hands
// back the intent props for its "record" button.
export function useCameraWarmUp(enabled = true): typeof cameraWarmUpIntentProps {
  useEffect(() => {
    if (!enabled) return () => {};

    return scheduleCameraWarmUp();
  }, [enabled]);

  return cameraWarmUpIntentProps;
}

export function resetCameraWarmUp(): void {
  warmUp = null;
}
