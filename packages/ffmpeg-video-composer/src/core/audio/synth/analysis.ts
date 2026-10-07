// Measurements of a rendered sound, so an author who can't hear checks it by numbers (MCP analyze_sound,
// the sound advisories, the preset parity test):
//   peakDb      sample peak, dBFS;
//   rmsDb       RMS level over the whole sound and every channel, dBFS (a plain RMS, not LUFS: no K-weighting
//               and no gating, which for sub-4 s effects mostly differs on the low end);
//   centroidHz  spectral centroid — the power-weighted mean frequency of 2048-point Hann frames, frames
//               weighted by their energy ("brightness": ~1 kHz warm, 4 kHz+ bright);
//   highShare   share of the spectral energy above 8 kHz (harshness), lowShare below 250 Hz (mud);
//   attackMs    time until the 5 ms RMS envelope first gets within 1 dB of its loudest point.
// Channels are averaged to mono for the spectrum. Pure.

import { createFft } from '../fft';
import { SYNTH_RATE } from './bounds';

export interface SoundMetrics {
  duration: number;
  peakDb: number;
  rmsDb: number;
  centroidHz: number;
  highShare: number;
  lowShare: number;
  attackMs: number;
}

const FRAME = 2048;
const HOP = 1024;
const HIGH_HZ = 8000;
const LOW_HZ = 250;
const ENVELOPE_SECONDS = 0.005;
const ATTACK_DB = 1;

function db(value: number): number {
  return value > 0 ? 20 * Math.log10(value) : Number.NEGATIVE_INFINITY;
}

function round(value: number, digits: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : value;
}

function mono(channels: readonly Float64Array[]): Float64Array {
  const out = new Float64Array(channels[0]?.length ?? 0);

  for (const channel of channels) {
    for (let i = 0; i < out.length; i++) out[i] += channel[i] / channels.length;
  }

  return out;
}

function levels(channels: readonly Float64Array[]): { peak: number; rms: number } {
  let peak = 0;
  let sum = 0;
  let count = 0;

  for (const channel of channels) {
    for (const value of channel) {
      peak = Math.max(peak, Math.abs(value));
      sum += value * value;
    }

    count += channel.length;
  }

  return { peak, rms: count > 0 ? Math.sqrt(sum / count) : 0 };
}

interface Spectrum {
  centroid: number;
  high: number;
  low: number;
}

function addFrame(signal: Float64Array, start: number, frame: Float64Array, bins: Float64Array, power: Float64Array) {
  for (let i = 0; i < FRAME; i++) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1));

    frame[i] = (signal[start + i] ?? 0) * window;
  }

  createFftCached().magnitudes(frame, bins);

  for (let bin = 0; bin < bins.length; bin++) power[bin] += bins[bin] * bins[bin];
}

let cachedFft: ReturnType<typeof createFft> | null = null;

function createFftCached(): ReturnType<typeof createFft> {
  cachedFft ??= createFft(FRAME);

  return cachedFft;
}

// The long-term power spectrum: frames summed by power, so loud frames weigh by their energy.
function spectrum(signal: Float64Array): Spectrum {
  const power = new Float64Array(FRAME / 2 + 1);
  const frame = new Float64Array(FRAME);
  const bins = new Float64Array(FRAME / 2 + 1);

  for (let start = 0; start < Math.max(1, signal.length - HOP); start += HOP) {
    addFrame(signal, start, frame, bins, power);
  }

  let total = 0;
  let weighted = 0;
  let high = 0;
  let low = 0;

  for (let bin = 1; bin < power.length; bin++) {
    const hz = (bin * SYNTH_RATE) / FRAME;

    total += power[bin];
    weighted += power[bin] * hz;
    high += hz >= HIGH_HZ ? power[bin] : 0;
    low += hz < LOW_HZ ? power[bin] : 0;
  }

  if (total === 0) return { centroid: 0, high: 0, low: 0 };

  return { centroid: weighted / total, high: high / total, low: low / total };
}

function attack(signal: Float64Array): number {
  const window = Math.round(ENVELOPE_SECONDS * SYNTH_RATE);
  const steps = Math.floor(signal.length / window);
  const envelope = new Float64Array(steps);

  for (let step = 0; step < steps; step++) {
    let sum = 0;

    for (let i = step * window; i < (step + 1) * window; i++) sum += signal[i] * signal[i];

    envelope[step] = Math.sqrt(sum / window);
  }

  const loudest = Math.max(0, ...envelope);

  if (loudest === 0) return 0;

  const reached = envelope.findIndex((value) => value >= loudest * 10 ** (-ATTACK_DB / 20));

  return (reached + 0.5) * ENVELOPE_SECONDS * 1000;
}

/** The metrics of a sound given as channels at the synth rate. */
export function analyzeChannels(channels: readonly Float64Array[]): SoundMetrics {
  const { peak, rms } = levels(channels);
  const signal = mono(channels);
  const spectral = spectrum(signal);

  return {
    duration: round(signal.length / SYNTH_RATE, 6),
    peakDb: round(db(peak), 2),
    rmsDb: round(db(rms), 2),
    centroidHz: round(spectral.centroid, 0),
    highShare: round(spectral.high, 3),
    lowShare: round(spectral.low, 3),
    attackMs: round(attack(signal), 1),
  };
}
