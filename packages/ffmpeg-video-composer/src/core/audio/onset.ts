// Onset strength for the beat analyzer: log-compressed spectral flux on ~10 ms hops (how much new energy
// each frame brings, summed over the spectrum), the frame loudness in dB for the cue finder, an adaptive
// threshold (sliding median + k·MAD) and the onsets that clear it. Pure and deterministic.

import { createFft } from './fft';

/** Hop between analysis frames, in seconds. */
export const HOP_SECONDS = 0.01;
/** Analysis window length, in seconds (rounded up to a power of two in samples). */
const WINDOW_SECONDS = 0.023;
/** Log compression of the magnitudes: log(1 + γ·|X|) weighs soft hits close to loud ones. */
const LOG_GAMMA = 100;
/** Half width of the sliding threshold window, in seconds. */
const THRESHOLD_HALF_WINDOW = 1.5;
/** Threshold = median + k·MAD. */
const THRESHOLD_K = 2;
/** Onsets closer than this are one onset. */
const MIN_ONSET_GAP = 0.05;
const SILENCE_DB = -100;

export interface OnsetEnvelope {
  /** Onset strength per hop (spectral flux). */
  flux: Float64Array;
  /** Frame loudness per hop, in dB (full scale = 0). */
  energy: Float64Array;
  /** Hops per second. */
  rate: number;
  /** Length of the analysed audio, in seconds. */
  duration: number;
}

function windowSize(sampleRate: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(64, sampleRate * WINDOW_SECONDS)));
}

function hann(size: number): Float64Array {
  const weights = new Float64Array(size);

  for (let index = 0; index < size; index++) weights[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / size);

  return weights;
}

function fillFrame(samples: Float32Array, center: number, weights: Float64Array, frame: Float64Array): number {
  const size = frame.length;
  const first = center - size / 2;
  let power = 0;

  for (let index = 0; index < size; index++) {
    const at = first + index;
    const sample = at >= 0 && at < samples.length ? samples[at] : 0;

    frame[index] = sample * weights[index];
    power += sample * sample;
  }

  return power / size;
}

function flux(current: Float64Array, previous: Float64Array): number {
  let total = 0;

  for (let bin = 0; bin < current.length; bin++) {
    const rise = current[bin] - previous[bin];

    if (rise > 0) total += rise;
  }

  return total;
}

/** The onset envelope of mono PCM samples (-1..1). */
export function onsetEnvelope(samples: Float32Array, sampleRate: number): OnsetEnvelope {
  const hop = Math.max(1, Math.round(sampleRate * HOP_SECONDS));
  const size = windowSize(sampleRate);
  const fft = createFft(size);
  const weights = hann(size);
  const frame = new Float64Array(size);
  const count = Math.ceil(samples.length / hop);
  const fluxes = new Float64Array(count);
  const energy = new Float64Array(count);
  let previous = new Float64Array(size / 2 + 1);
  let current = new Float64Array(size / 2 + 1);

  for (let index = 0; index < count; index++) {
    const power = fillFrame(samples, index * hop, weights, frame);

    fft.magnitudes(frame, current);

    for (let bin = 0; bin < current.length; bin++) current[bin] = Math.log1p(LOG_GAMMA * current[bin]);
    fluxes[index] = flux(current, previous);
    energy[index] = power > 0 ? Math.max(SILENCE_DB, 10 * Math.log10(power)) : SILENCE_DB;
    [previous, current] = [current, previous];
  }

  return { flux: fluxes, energy, rate: sampleRate / hop, duration: samples.length / sampleRate };
}

function median(values: number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Median and median absolute deviation of `values`. */
export function medianMad(values: Iterable<number>): { median: number; mad: number } {
  const list = [...values];

  if (list.length === 0) return { median: 0, mad: 0 };

  const center = median(list);

  return { median: center, mad: median(list.map((value) => Math.abs(value - center))) };
}

// The threshold is evaluated every STRIDE hops and held in between: a sliding median is the costly part.
const STRIDE = 5;

/** Adaptive threshold per hop: median + k·MAD of the envelope within ±1.5 s. */
export function adaptiveThreshold(values: Float64Array, rate: number, k = THRESHOLD_K): Float64Array {
  const half = Math.max(1, Math.round(THRESHOLD_HALF_WINDOW * rate));
  const out = new Float64Array(values.length);

  for (let start = 0; start < values.length; start += STRIDE) {
    const window = values.subarray(Math.max(0, start - half), Math.min(values.length, start + half + 1));
    const stats = medianMad(window);

    out.fill(stats.median + k * stats.mad, start, Math.min(values.length, start + STRIDE));
  }

  return out;
}

function isPeak(values: Float64Array, index: number): boolean {
  const before = index === 0 ? -Infinity : values[index - 1];
  const after = index === values.length - 1 ? -Infinity : values[index + 1];

  return values[index] > before && values[index] >= after;
}

/** Hop indices of the local maxima that clear the threshold, at least 50 ms apart (strongest kept). */
export function pickOnsets(values: Float64Array, threshold: Float64Array, rate: number): number[] {
  const gap = Math.max(1, Math.round(MIN_ONSET_GAP * rate));
  const onsets: number[] = [];

  for (let index = 0; index < values.length; index++) {
    if (values[index] <= threshold[index] || !isPeak(values, index)) continue;

    const last = onsets.at(-1);

    if (last !== undefined && index - last < gap) {
      if (values[index] > values[last]) onsets[onsets.length - 1] = index;
      continue;
    }

    onsets.push(index);
  }

  return onsets;
}
