// Decodes a reference image or clip into small RGBA frames for the style analyzer, in the browser:
// the image through an <img> + canvas, the clip through a <video> seeked to fixed times. The sample
// times depend only on the clip's duration, so the same clip always yields the same frames.
import type { StyleFrame } from 'ffmpeg-video-composer/src/core/style/types.ts';

/** Analysis frames are 160 px wide, like the engine's ffmpeg decode (`scale=160:-2`). */
export const REFERENCE_WIDTH = 160;
const SAMPLE_INTERVAL = 0.25;
/** Seeking is slow in a browser: at most 120 frames (30 s at 4 fps), evenly spaced beyond that. */
export const MAX_REFERENCE_FRAMES = 120;
const SEEK_TIMEOUT_MS = 5000;

/** Fixed sample times for a clip: every 0.25 s, or `max` evenly spaced frames across a longer clip. */
export function referenceSampleTimes(duration: number, max = MAX_REFERENCE_FRAMES): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [0];

  const fps = duration / SAMPLE_INTERVAL <= max ? 1 / SAMPLE_INTERVAL : max / duration;
  const count = Math.max(1, Math.min(max, Math.floor(duration * fps)));

  return Array.from({ length: count }, (_, i) => Math.round((i / fps) * 1000) / 1000);
}

/** Output size at the analysis width, height rounded to an even number (as ffmpeg's `-2`). */
export function analysisSize(width: number, height: number): { width: number; height: number } {
  const scaled = Math.max(2, Math.round((REFERENCE_WIDTH * height) / Math.max(1, width) / 2) * 2);

  return { width: REFERENCE_WIDTH, height: scaled };
}

function grab(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, time?: number): StyleFrame {
  const size = analysisSize(sourceWidth, sourceHeight);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (!context) throw new Error('Canvas 2D is unavailable');

  context.drawImage(source, 0, 0, size.width, size.height);
  const { data } = context.getImageData(0, 0, size.width, size.height);

  return { data, width: size.width, height: size.height, channels: 4, ...(time === undefined ? {} : { time }) };
}

function once(target: EventTarget, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${event}`));
    }, SEEK_TIMEOUT_MS);
    target.addEventListener(
      event,
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
    target.addEventListener(
      'error',
      () => {
        clearTimeout(timer);
        reject(new Error('The reference could not be decoded'));
      },
      { once: true }
    );
  });
}

/** One RGBA frame from a reference image file. */
export async function imageFrame(file: Blob): Promise<StyleFrame> {
  const url = URL.createObjectURL(file);

  try {
    const image = new Image();
    const loaded = once(image, 'load');
    image.src = url;
    await loaded;

    return grab(image, image.naturalWidth, image.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  const seeked = once(video, 'seeked');
  video.currentTime = time;
  await seeked;
}

/** RGBA frames from a reference clip at the fixed sample times, plus its duration. */
export async function clipFrames(
  file: Blob,
  signal?: AbortSignal
): Promise<{ frames: StyleFrame[]; duration: number }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.playsInline = true;

  try {
    const ready = once(video, 'loadeddata');
    video.src = url;
    await ready;
    const frames: StyleFrame[] = [];
    // One seek at a time: a <video> has a single playhead, so the grabs are chained, never parallel.
    await referenceSampleTimes(video.duration).reduce(async (previous, time) => {
      await previous;
      signal?.throwIfAborted();
      await seekTo(video, time);
      frames.push(grab(video, video.videoWidth, video.videoHeight, time));
    }, Promise.resolve());

    return { frames, duration: video.duration };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
