// Texture estimate: film grain read as high-frequency luma energy. The 4-neighbour Laplacian residual
// is near zero on flat areas and gradients and large on edges; edges are sparse, so the MEDIAN residual
// tracks the noise floor rather than the drawing. Measured on the downscaled analysis frames, so the
// threshold is for "grain still visible at a glance", not sensor noise.

import type { StyleFrame, Texture } from './types';

const MAX_FRAMES = 12;
// Median residual / 4 ≈ per-pixel noise amplitude in 8-bit steps.
const GRAIN_THRESHOLD = 2.5;

export function lumaOf(frame: StyleFrame): Uint8Array {
  const channels = frame.channels ?? 3;
  const count = frame.width * frame.height;
  const out = new Uint8Array(count);

  for (let p = 0; p < count; p++) {
    const o = p * channels;
    out[p] = Math.round(0.299 * frame.data[o] + 0.587 * frame.data[o + 1] + 0.114 * frame.data[o + 2]);
  }

  return out;
}

function medianFromHistogram(histogram: Uint32Array, total: number): number {
  let seen = 0;

  for (let v = 0; v < histogram.length; v++) {
    seen += histogram[v];

    if (seen * 2 >= total) return v;
  }

  return 0;
}

function frameNoise(frame: StyleFrame): number {
  const { width, height } = frame;

  if (width < 3 || height < 3) return 0;

  const luma = lumaOf(frame);
  const histogram = new Uint32Array(1021);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x;
      const residual = 4 * luma[p] - luma[p - 1] - luma[p + 1] - luma[p - width] - luma[p + width];
      histogram[Math.abs(residual)]++;
    }
  }

  return medianFromHistogram(histogram, (width - 2) * (height - 2)) / 4;
}

function evenly<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items];

  return Array.from({ length: max }, (_, i) => items[Math.floor((i * items.length) / max)]);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Grain estimate over up to twelve evenly spaced frames, with a `global.grade.grain` suggestion. */
export function estimateTexture(frames: readonly StyleFrame[]): Texture {
  if (frames.length === 0) return { noise: 0, look: 'none' };

  const noise = Math.round(median(evenly(frames, MAX_FRAMES).map(frameNoise)) * 100) / 100;

  if (noise < GRAIN_THRESHOLD) return { noise, look: 'none' };

  const grain = Math.min(0.6, Math.max(0.1, 0.1 + (noise - GRAIN_THRESHOLD) / 20));

  return { noise, look: 'grain', grain: Math.round(grain * 100) / 100 };
}
