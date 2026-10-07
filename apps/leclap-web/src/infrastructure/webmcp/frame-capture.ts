// Stills from a rendered preview for the browser agent's render_frames: a detached <video> on the
// preview's same-origin object URL (so the canvas stays readable and the user's own playback is left
// alone) seeks to each time, draws to a canvas scaled to at most 960 px wide, and encodes a JPEG whose
// quality steps down until it fits the byte budget.
export interface Frame {
  at: number;
  data: string;
  bytes: number;
  width: number;
  height: number;
}

/** Largest JPEG per frame, in bytes (render_frames' contract). */
export const MAX_FRAME_BYTES = 200 * 1024;
const MAX_WIDTH = 960;
const QUALITIES = [0.82, 0.7, 0.55, 0.4, 0.28];
const SEEK_TIMEOUT_MS = 10_000;

function once(target: HTMLVideoElement, event: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      finish(new Error(`video ${event} timed out`));
    }, SEEK_TIMEOUT_MS);
    const onEvent = (): void => {
      finish(null);
    };
    const onError = (): void => {
      finish(new Error('the preview video could not be read'));
    };
    const onAbort = (): void => {
      finish(new Error('aborted'));
    };
    function finish(error: Error | null): void {
      clearTimeout(timer);
      target.removeEventListener(event, onEvent);
      target.removeEventListener('error', onError);
      signal.removeEventListener('abort', onAbort);

      if (error) reject(error);

      if (!error) resolve();
    }
    target.addEventListener(event, onEvent, { once: true });
    target.addEventListener('error', onError, { once: true });
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', quality);
  });
}

async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';

  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCodePoint(...bytes.subarray(i, i + 0x8000));

  return btoa(binary);
}

/** The best JPEG of `canvas` within `maxBytes` (from quality step `step` down), or null when none fits. */
async function encode(canvas: HTMLCanvasElement, maxBytes: number, step = 0): Promise<Blob | null> {
  const quality = QUALITIES.at(step);

  if (quality === undefined) return null;

  const blob = await toBlob(canvas, quality);

  return blob && blob.size <= maxBytes ? blob : encode(canvas, maxBytes, step + 1);
}

async function grab(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  at: number,
  maxBytes: number,
  signal: AbortSignal
) {
  const time = Math.min(Math.max(0, at), Math.max(0, video.duration - 0.05));
  const seeked = once(video, 'seeked', signal);
  video.currentTime = time;
  await seeked;
  canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await encode(canvas, maxBytes);

  if (!blob) throw new Error('a frame did not fit the size budget');

  return {
    at: Math.round(time * 100) / 100,
    data: await base64(blob),
    bytes: blob.size,
    width: canvas.width,
    height: canvas.height,
  };
}

/** JPEG frames of the video at `url`, at each of `at` seconds (clamped to its length). */
export async function captureFrames(url: string, at: number[], maxBytes: number, signal: AbortSignal) {
  const video = document.createElement('video');

  // The preview is H.264 MP4: builds without that decoder (some Chromium builds) cannot read it back.
  if (video.canPlayType('video/mp4; codecs="avc1.42E01E"') === '') {
    throw new Error('this browser cannot decode the preview (H.264); the user can still watch it');
  }

  video.muted = true;
  video.preload = 'auto';
  const loaded = once(video, 'loadeddata', signal);
  video.src = url;

  try {
    await loaded;
    const scale = Math.min(1, MAX_WIDTH / (video.videoWidth || MAX_WIDTH));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round((video.videoWidth || MAX_WIDTH) * scale);
    canvas.height = Math.round((video.videoHeight || MAX_WIDTH * 0.5625) * scale);
    // One seek at a time: the frames share the video element.
    const frames = await at.reduce<Promise<Frame[]>>(
      async (previous, time) => [...(await previous), await grab(video, canvas, time, maxBytes, signal)],
      Promise.resolve([])
    );

    return { durationSeconds: Math.round(video.duration * 10) / 10, frames };
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}
