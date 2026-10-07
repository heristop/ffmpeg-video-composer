// Beat and cue analysis of a music track, platform-neutral: mono PCM in, the beat grid `global.beats`
// takes out. Onset strength by spectral flux on ~10 ms hops (onset.ts), tempo by autocorrelation in
// 60–200 BPM with half/double reconciliation (tempo.ts), phase by comb alignment, beat tracking and a
// least-squares fit, downbeat by accent strength (grid.ts), and the drop/build/end cues from the loudness
// curve (cues.ts). Deterministic: the same samples always give the same analysis.
//
// `usable` is false when the track has no reliable pulse (calm, ambient, rubato music): pace such a track
// by phrases and section lengths, not by beats.

import { findCues, type MusicCues } from './cues';
import { alignComb, downbeatIndex, fitGrid, trackBeats, type Comb, type TrackedBeat } from './grid';
import { adaptiveThreshold, onsetEnvelope, pickOnsets, type OnsetEnvelope } from './onset';
import { estimateTempo, sampleAt } from './tempo';

export type { MusicCues } from './cues';

/** A beat grid is usable at or above this autocorrelation z-score... */
export const MIN_CONFIDENCE = 3;
/** ...and when at least this share of its beats land on an onset. */
const MIN_SNAPPED_SHARE = 0.5;
const DEFAULT_BEATS_PER_BAR = 4;
// Flux peaks a little before the hit it measures (the window starts rising as the hit enters it); this
// shifts beat times back onto the hit, measured on synthetic clicks.
const FLUX_LATENCY = 0.003;

export interface BeatAnalysis {
  /** Tempo in beats per minute. */
  bpm: number;
  /** Time of beat 1 (the first downbeat), in seconds. */
  offset: number;
  beatsPerBar: number;
  /** Tracked beat times from beat 1 on, in seconds (rounded to the millisecond). */
  times: number[];
  /** Z-score of the tempo's autocorrelation peak; 3 or more is a clear pulse. */
  confidence: number;
  /** False when the track has no reliable pulse: pace it by phrases, not beats. */
  usable: boolean;
  cues: MusicCues;
}

export interface BeatAnalysisOptions {
  /** Beats per bar for the downbeat estimate (default 4). */
  beatsPerBar?: number;
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

// Binomial smoothing (σ ≈ 1 hop): hits quantised to different hops still line up in the autocorrelation.
const KERNEL = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16];

function smooth(values: Float64Array): Float64Array {
  return values.map((_, index) =>
    KERNEL.reduce((sum, weight, tap) => sum + weight * (values[index + tap - 2] ?? 0), 0)
  );
}

// The onset envelope above its local median (the noise floor), smoothed, and its adaptive threshold.
interface Detrended {
  raw: Float64Array;
  values: Float64Array;
  threshold: Float64Array;
}

function detrend(envelope: OnsetEnvelope): Detrended {
  const floor = adaptiveThreshold(envelope.flux, envelope.rate, 0);
  const raw = envelope.flux.map((value, index) => Math.max(0, value - floor[index]));
  const values = smooth(raw);

  return { raw, values, threshold: adaptiveThreshold(values, envelope.rate) };
}

function seconds(hops: number, rate: number): number {
  return Math.max(0, hops / rate + FLUX_LATENCY);
}

function accents(values: Float64Array, beats: readonly TrackedBeat[]): number[] {
  return beats.map((beat) =>
    Math.max(sampleAt(values, beat.at - 1), sampleAt(values, beat.at), sampleAt(values, beat.at + 1))
  );
}

function silent(envelope: OnsetEnvelope, beatsPerBar: number): BeatAnalysis {
  return {
    bpm: 120,
    offset: 0,
    beatsPerBar,
    times: [],
    confidence: 0,
    usable: false,
    cues: findCues(envelope.energy, envelope.rate, envelope.duration),
  };
}

interface Grid {
  fitted: Comb;
  beats: TrackedBeat[];
  first: number;
}

function grid(values: Float64Array, threshold: Float64Array, period: number, beatsPerBar: number): Grid {
  const comb = alignComb(values, period);
  const tracked = trackBeats(values, threshold, comb);
  const fitted = fitGrid(tracked, comb);
  const first = downbeatIndex(accents(values, tracked), beatsPerBar);

  return { fitted, beats: tracked, first };
}

function snapCue(cues: MusicCues, times: readonly number[], usable: boolean): MusicCues {
  if (!usable || cues.drop === undefined || times.length === 0) return cues;

  const drop = cues.drop;
  const nearest = times.reduce((best, time) => (Math.abs(time - drop) < Math.abs(best - drop) ? time : best));

  return Math.abs(nearest - drop) <= 0.25 ? { ...cues, drop: nearest } : cues;
}

/** Beat grid, confidence and cues of mono PCM `samples` (-1..1) at `sampleRate` Hz. */
export function analyzeBeats(
  samples: Float32Array,
  sampleRate: number,
  options: BeatAnalysisOptions = {}
): BeatAnalysis {
  const beatsPerBar = options.beatsPerBar ?? DEFAULT_BEATS_PER_BAR;
  const envelope = onsetEnvelope(samples, sampleRate);
  const { raw, values, threshold } = detrend(envelope);
  const tempo = estimateTempo(values, raw, envelope.rate);

  if (!tempo) return silent(envelope, beatsPerBar);

  const { fitted, beats, first } = grid(values, threshold, tempo.period, beatsPerBar);
  const kept = beats.slice(first);
  const snapped = kept.filter((beat) => beat.snapped).length / Math.max(1, kept.length);
  const usable = tempo.confidence >= MIN_CONFIDENCE && snapped >= MIN_SNAPPED_SHARE;
  const times = kept.map((beat) => round(seconds(beat.at, envelope.rate), 3));
  const cues = findCues(envelope.energy, envelope.rate, envelope.duration);

  return {
    bpm: round((60 * envelope.rate) / fitted.period, 2),
    offset: round(seconds(fitted.phase + first * fitted.period, envelope.rate), 3),
    beatsPerBar,
    times,
    confidence: round(tempo.confidence, 2),
    usable,
    cues: snapCue(roundCues(cues), times, usable),
  };
}

function roundCues(cues: MusicCues): MusicCues {
  return Object.fromEntries(Object.entries(cues).map(([name, at]) => [name, round(at, 3)])) as unknown as MusicCues;
}

/** Hop indices of the onsets in `samples`: exposed for diagnostics and tests. */
export function detectOnsets(samples: Float32Array, sampleRate: number): number[] {
  const envelope = onsetEnvelope(samples, sampleRate);
  const { values, threshold } = detrend(envelope);

  return pickOnsets(values, threshold, envelope.rate).map((hop) => round(seconds(hop, envelope.rate), 3));
}
