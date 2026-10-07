// Tempo from the onset envelope: autocorrelation over the 60–200 BPM lags, weighted by a broad tempo prior
// (one octave around 120 BPM), then half/double reconciliation toward the 80–160 BPM band people tap
// to. The confidence is the z-score of the chosen autocorrelation peak among all candidate lags: a clear
// pulse stands far above the rest, an ambient pad does not. Pure and deterministic.

export const MIN_BPM = 60;
export const MAX_BPM = 200;
const PRIOR_BPM = 120;
const PRIOR_OCTAVES = 1;
/** Reconciliation band: a tempo outside it switches octave when the other octave is clearly present. */
const BAND_LOW = 80;
const BAND_HIGH = 160;
const OCTAVE_EVIDENCE = 0.5;

export interface TempoEstimate {
  /** Beat period in hops (fractional). */
  period: number;
  /** Z-score of the autocorrelation peak among the candidate lags (0 when there is no pulse). */
  confidence: number;
}

/** Normalised autocorrelation of `values` for lags 0..maxLag (lag 0 = 1 unless the input is silent). */
export function autocorrelation(values: Float64Array, maxLag: number): Float64Array {
  const out = new Float64Array(maxLag + 1);

  for (let lag = 0; lag <= maxLag && lag < values.length; lag++) {
    let total = 0;

    for (let index = 0; index + lag < values.length; index++) total += values[index] * values[index + lag];

    out[lag] = total / (values.length - lag);
  }

  const zero = out[0];

  if (zero > 0) for (let lag = 0; lag <= maxLag; lag++) out[lag] /= zero;

  return out;
}

/** Linear interpolation of `values` at a fractional index (0 outside). */
export function sampleAt(values: ArrayLike<number>, at: number): number {
  const left = Math.floor(at);

  if (left < 0 || left >= values.length) return 0;

  const right = Math.min(values.length - 1, left + 1);
  const fraction = at - left;

  return values[left] * (1 - fraction) + values[right] * fraction;
}

function prior(bpm: number): number {
  const octaves = Math.log2(bpm / PRIOR_BPM) / PRIOR_OCTAVES;

  return Math.exp(-0.5 * octaves * octaves);
}

function isLocalMax(values: Float64Array, lag: number): boolean {
  return values[lag] >= values[lag - 1] && values[lag] >= (values[lag + 1] ?? -Infinity);
}

// Parabolic interpolation of the peak around an integer lag.
function refinePeak(values: Float64Array, lag: number): number {
  const left = values[lag - 1];
  const right = values[lag + 1] ?? values[lag];
  const curvature = left - 2 * values[lag] + right;

  if (curvature >= 0) return lag;

  return lag + (0.5 * (left - right)) / curvature;
}

function lagRange(rate: number): [number, number] {
  return [Math.max(2, Math.floor((60 * rate) / MAX_BPM)), Math.ceil((60 * rate) / MIN_BPM)];
}

function bestLag(ac: Float64Array, rate: number): number | null {
  const [low, high] = lagRange(rate);
  let best: number | null = null;
  let bestScore = 0;

  for (let lag = low; lag <= high; lag++) {
    const score = ac[lag] * prior((60 * rate) / lag);

    if (isLocalMax(ac, lag) && score > bestScore) {
      best = lag;
      bestScore = score;
    }
  }

  return best;
}

function zScore(ac: Float64Array, lag: number, rate: number): number {
  const [low, high] = lagRange(rate);
  const values = [...ac.subarray(low, high + 1)];
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;

  return variance > 0 ? (sampleAt(ac, lag) - mean) / Math.sqrt(variance) : 0;
}

/**
 * Moves a period one octave toward 80–160 BPM when it sits outside that band and the other octave is
 * clearly present: 70 BPM with eighth notes reads as 140, 174 BPM with every other hit present as 87.
 */
export function reconcileOctave(ac: Float64Array, period: number, rate: number): number {
  const bpm = (60 * rate) / period;
  const strength = sampleAt(ac, period);
  const half = sampleAt(ac, period / 2);

  if (bpm < BAND_LOW && half >= OCTAVE_EVIDENCE * strength) return period / 2;

  if (bpm > BAND_HIGH && sampleAt(ac, period * 2) >= OCTAVE_EVIDENCE * strength) return period * 2;

  return period;
}

/**
 * The beat period of an onset envelope (`rate` hops per second), or null when nothing pulses. The period
 * is read off the smoothed envelope (hits quantised to neighbouring hops still line up); the confidence
 * off the raw one, whose sharper peaks separate a real pulse from a flat texture better.
 */
export function estimateTempo(smoothed: Float64Array, raw: Float64Array, rate: number): TempoEstimate | null {
  const [, high] = lagRange(rate);
  const ac = autocorrelation(smoothed, 2 * high + 2);

  if (ac[0] === 0) return null;

  const lag = bestLag(ac, rate);

  if (lag === null) return null;

  const period = reconcileOctave(ac, refinePeak(ac, lag), rate);
  const sharp = autocorrelation(raw, high + 1);

  return { period, confidence: Math.max(0, zScore(sharp, period, rate)) };
}
