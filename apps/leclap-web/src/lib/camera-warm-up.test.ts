import { describe, it, expect, vi, afterEach } from 'vitest';
import { warmUpCamera, scheduleCameraWarmUp, resetCameraWarmUp } from './camera-warm-up';

// The browser enumerates its capture devices on the first getUserMedia of a page, which is what made the
// first camera open of a session slow. enumerateDevices pays that cost without opening the camera or
// prompting, so the recorder warms it ahead of the click.
const stubMediaDevices = (mediaDevices: unknown): void => {
  vi.stubGlobal('navigator', { mediaDevices });
};

afterEach(() => {
  resetCameraWarmUp();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('warmUpCamera', () => {
  it('enumerates the capture devices without asking for a stream', async () => {
    const enumerateDevices = vi.fn().mockResolvedValue([]);
    const getUserMedia = vi.fn();
    stubMediaDevices({ enumerateDevices, getUserMedia });

    await warmUpCamera();

    expect(enumerateDevices).toHaveBeenCalledTimes(1);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('warms up once per page, however many times it is asked', async () => {
    const enumerateDevices = vi.fn().mockResolvedValue([]);
    stubMediaDevices({ enumerateDevices });

    await Promise.all([warmUpCamera(), warmUpCamera()]);
    await warmUpCamera();

    expect(enumerateDevices).toHaveBeenCalledTimes(1);
  });

  it('swallows a failed enumeration, so the recorder still opens normally', async () => {
    stubMediaDevices({ enumerateDevices: vi.fn().mockRejectedValue(new Error('NotAllowedError')) });

    await expect(warmUpCamera()).resolves.toBeUndefined();
  });

  it('is a no-op where the browser has no media devices (insecure origin, old browser)', async () => {
    stubMediaDevices(undefined);

    await expect(warmUpCamera()).resolves.toBeUndefined();
  });
});

describe('scheduleCameraWarmUp', () => {
  it('warms up once the main thread is idle', () => {
    const enumerateDevices = vi.fn().mockResolvedValue([]);
    stubMediaDevices({ enumerateDevices });
    let idle: (() => void) | undefined;
    vi.stubGlobal('requestIdleCallback', (callback: () => void) => {
      idle = callback;

      return 7;
    });
    vi.stubGlobal('cancelIdleCallback', vi.fn());

    scheduleCameraWarmUp();
    expect(enumerateDevices).not.toHaveBeenCalled();

    idle?.();
    expect(enumerateDevices).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending warm-up when the recorder entry goes away first', () => {
    const enumerateDevices = vi.fn().mockResolvedValue([]);
    stubMediaDevices({ enumerateDevices });
    const cancelIdleCallback = vi.fn();
    vi.stubGlobal('requestIdleCallback', () => 7);
    vi.stubGlobal('cancelIdleCallback', cancelIdleCallback);

    const cancel = scheduleCameraWarmUp();
    cancel();

    expect(cancelIdleCallback).toHaveBeenCalledWith(7);
    expect(enumerateDevices).not.toHaveBeenCalled();
  });

  it('falls back to a timer where requestIdleCallback is missing (Safari)', () => {
    vi.useFakeTimers();
    const enumerateDevices = vi.fn().mockResolvedValue([]);
    stubMediaDevices({ enumerateDevices });
    vi.stubGlobal('requestIdleCallback', undefined);

    scheduleCameraWarmUp();
    vi.runAllTimers();

    expect(enumerateDevices).toHaveBeenCalledTimes(1);
  });
});
