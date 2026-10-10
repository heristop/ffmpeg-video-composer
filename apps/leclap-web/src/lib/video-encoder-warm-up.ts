// Chrome sets up its hardware H.264 encoder (VideoToolbox on macOS) the first time a MediaRecorder encodes
// H.264 in the browser session, and every video on screen stalls while it does: the first take of a
// session froze the live preview for a second or more right as recording began, and its clip opened on
// a held frame while the sound ran on. Later takes, and takes after a reload, start at once. Encoding a
// throwaway canvas while the camera opens pays that one-time cost behind "Starting camera…" instead.

// A frame size on the hardware path. Below it (a 404x720 portrait crop) Chrome encodes in software,
// which starts at once but leaves the hardware encoder cold; once the hardware encoder is set up at any
// size, takes of every size start without the stall.
const WARM_UP_WIDTH = 1280;
const WARM_UP_HEIGHT = 720;

// Past this the encoder is not coming; release the canvas rather than hold it. Generous on purpose: on a
// heavily loaded machine the set-up took 10–20s.
const GIVE_UP_MS = 30_000;

let warmUp: Promise<void> | null = null;

// The throwaway streams this module encodes, so a diagnostic can tell them from a take.
const warmUpStreams = new WeakSet<MediaStream>();

export function isWarmUpStream(stream: MediaStream): boolean {
  return warmUpStreams.has(stream);
}

// The stall was measured in Chromium only; Safari also records H.264 MP4 but was never seen to stall,
// so it isn't handed an extra encoder while its camera opens. `userAgentData` exists only in Chromium.
function isChromium(): boolean {
  const brands = (navigator as { userAgentData?: { brands?: Array<{ brand: string }> } }).userAgentData?.brands;

  return brands?.some((entry) => entry.brand === 'Chromium') ?? false;
}

// The video-only H.264 type to warm, or null when the recording is not H.264 (WebM's VP8/VP9 encoders
// start without the stall).
export function warmUpMimeType(mimeType: string | undefined): string | null {
  const match = mimeType?.match(/^video\/mp4;codecs=(.+)$/);
  const avc = match?.[1].split(',').find((codec) => codec.trim().startsWith('avc1'));

  if (!avc) return null;

  return `video/mp4;codecs=${avc.trim()}`;
}

// A canvas that keeps changing, so captureStream keeps producing the frames the encoder needs to start.
function paintingCanvas(width: number, height: number): { stream: MediaStream; stop: () => void } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  let frame = 0;
  let raf = 0;
  const paint = (): void => {
    if (ctx) {
      ctx.fillStyle = frame % 2 === 0 ? '#000' : '#111';
      ctx.fillRect(0, 0, width, height);
    }
    frame += 1;
    raf = requestAnimationFrame(paint);
  };
  paint();
  const stream = canvas.captureStream(30);
  warmUpStreams.add(stream);

  return {
    stream,
    stop: () => {
      cancelAnimationFrame(raf);

      for (const track of stream.getTracks()) {
        track.stop();
      }
    },
  };
}

// Resolves once the recorder has started (or failed, or given up), and always stops it.
function encodeUntilStarted(stream: MediaStream, mimeType: string): Promise<void> {
  return new Promise((resolve) => {
    let recorder: MediaRecorder;

    try {
      recorder = new MediaRecorder(stream, { mimeType });
    } catch {
      resolve();

      return;
    }

    const finish = (): void => {
      clearTimeout(timer);

      if (recorder.state !== 'inactive') {
        recorder.addEventListener('stop', () => {
          resolve();
        });
        recorder.stop();

        return;
      }

      resolve();
    };
    const timer = setTimeout(finish, GIVE_UP_MS);
    recorder.addEventListener('start', finish);
    recorder.addEventListener('error', finish);

    try {
      recorder.start();
    } catch {
      finish();
    }
  });
}

async function runWarmUp(width: number, height: number, mimeType: string): Promise<void> {
  const canvas = paintingCanvas(width, height);

  try {
    await encodeUntilStarted(canvas.stream, mimeType);
  } finally {
    canvas.stop();
  }
}

// Warms the encoder a recording of this type will use, once per page. Never rejects.
export function warmUpVideoEncoder(mimeType: string | undefined): Promise<void> {
  if (warmUp) return warmUp;

  const videoType = warmUpMimeType(mimeType);

  if (!videoType || typeof MediaRecorder === 'undefined' || typeof document === 'undefined' || !isChromium()) {
    return Promise.resolve();
  }

  warmUp = runWarmUp(WARM_UP_WIDTH, WARM_UP_HEIGHT, videoType).catch(() => {});

  return warmUp;
}

export function resetVideoEncoderWarmUp(): void {
  warmUp = null;
}
