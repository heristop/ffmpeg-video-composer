import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { warmUpVideoEncoder, resetVideoEncoderWarmUp, warmUpMimeType, isWarmUpStream } from './video-encoder-warm-up';

// Chrome sets up its hardware H.264 encoder the first time a MediaRecorder encodes H.264 in the browser
// session, and every video on screen stalls while it does: the live preview froze the moment the first
// take began. The warm-up encodes a throwaway canvas while the camera opens, so that one-time cost is
// paid behind "Starting camera…" and the take starts on an encoder that is already set up.

interface FakeRecorder {
  stream: MediaStream;
  options?: MediaRecorderOptions;
  state: string;
  listeners: Record<string, Array<() => void>>;
  fire: (type: string) => void;
}

let recorders: FakeRecorder[];
let canvases: Array<{ width: number; height: number; trackStopped: boolean }>;
let autoStart: boolean;

const installFakes = (): void => {
  recorders = [];
  canvases = [];
  autoStart = true;

  class FakeMediaRecorder {
    state = 'inactive';
    listeners: Record<string, Array<() => void>> = {};
    constructor(
      public stream: MediaStream,
      public options?: MediaRecorderOptions
    ) {
      recorders.push(this as unknown as FakeRecorder);
    }
    addEventListener(type: string, fn: () => void): void {
      (this.listeners[type] ??= []).push(fn);
    }
    fire(type: string): void {
      for (const fn of this.listeners[type] ?? []) fn();
    }
    start(): void {
      this.state = 'recording';

      if (autoStart) queueMicrotask(() => this.fire('start'));
    }
    stop(): void {
      this.state = 'inactive';
      queueMicrotask(() => this.fire('stop'));
    }
  }

  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const createElement = (): HTMLElement => {
    const record = { width: 0, height: 0, trackStopped: false };
    canvases.push(record);
    const track = {
      stop: () => {
        record.trackStopped = true;
      },
    };

    return {
      set width(w: number) {
        record.width = w;
      },
      set height(h: number) {
        record.height = h;
      },
      getContext: () => ({ fillRect: () => {}, fillStyle: '' }),
      captureStream: () => ({ getTracks: () => [track] }),
    } as unknown as HTMLElement;
  };
  vi.stubGlobal('document', { createElement });
  vi.stubGlobal('navigator', { userAgentData: { brands: [{ brand: 'Chromium', version: '141' }] } });
};

beforeEach(installFakes);

afterEach(() => {
  resetVideoEncoderWarmUp();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('warmUpMimeType', () => {
  it('keeps only the H.264 video codec of an MP4 recording type', () => {
    expect(warmUpMimeType('video/mp4;codecs=avc1.42E01E,mp4a.40.2')).toBe('video/mp4;codecs=avc1.42E01E');
  });

  it('skips WebM and unknown types, whose encoders start without the stall', () => {
    expect(warmUpMimeType('video/webm;codecs=vp9,opus')).toBeNull();
    expect(warmUpMimeType('video/webm')).toBeNull();
    expect(warmUpMimeType(undefined)).toBeNull();
  });
});

describe('warmUpVideoEncoder', () => {
  const mp4 = 'video/mp4;codecs=avc1.42E01E,mp4a.40.2';

  it('encodes a throwaway video-only canvas at a hardware-encoder size, then stops it', async () => {
    await warmUpVideoEncoder(mp4);

    expect(recorders).toHaveLength(1);
    expect(recorders[0].options).toEqual({ mimeType: 'video/mp4;codecs=avc1.42E01E' });
    expect(canvases[0]).toMatchObject({ width: 1280, height: 720 });
    expect(recorders[0].state).toBe('inactive');
    expect(canvases[0].trackStopped).toBe(true);
  });

  it('does nothing for a WebM recording', async () => {
    await warmUpVideoEncoder('video/webm;codecs=vp9,opus');

    expect(recorders).toHaveLength(0);
  });

  it('warms once per page', async () => {
    await warmUpVideoEncoder(mp4);
    await warmUpVideoEncoder(mp4);

    expect(recorders).toHaveLength(1);
  });

  it('settles quietly when the recorder cannot be built', async () => {
    vi.stubGlobal(
      'MediaRecorder',
      class {
        constructor() {
          throw new Error('NotSupportedError');
        }
      }
    );

    await expect(warmUpVideoEncoder(mp4)).resolves.toBeUndefined();
    expect(canvases[0].trackStopped).toBe(true);
  });

  it('gives up and releases the canvas when the encoder never starts', async () => {
    vi.useFakeTimers();
    autoStart = false;

    const done = warmUpVideoEncoder(mp4);
    await vi.advanceTimersByTimeAsync(30_000);
    await done;

    expect(recorders[0].state).toBe('inactive');
    expect(canvases[0].trackStopped).toBe(true);
  });

  it('does nothing outside Chromium, whose H.264 set-up is the one that stalls the page', async () => {
    vi.stubGlobal('navigator', {});

    await warmUpVideoEncoder(mp4);

    expect(recorders).toHaveLength(0);
  });

  it('marks its throwaway stream, so a take is never mistaken for it', async () => {
    await warmUpVideoEncoder(mp4);

    expect(isWarmUpStream(recorders[0].stream)).toBe(true);
    expect(isWarmUpStream({} as MediaStream)).toBe(false);
  });

  it('does nothing where MediaRecorder is missing', async () => {
    vi.stubGlobal('MediaRecorder', undefined);

    await expect(warmUpVideoEncoder(mp4)).resolves.toBeUndefined();
    expect(canvases).toHaveLength(0);
  });
});
