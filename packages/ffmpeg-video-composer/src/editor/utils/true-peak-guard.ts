// True-peak guard for the single-pass loudnorm. loudnorm limits the true peak of the PCM it outputs, but
// the AAC encode that follows reshapes the waveform and can overshoot the ceiling by a few tenths of a
// dB. When the adapter can measure the encoded file (Node), the guard re-measures it after each pass and,
// above target + 0.1 dB, re-runs the pass with the ceiling lowered by the overshoot plus 0.2 dB, at most
// twice. The report records what was used.

import type { LoudnessReport } from '@/core/qc/types';
import { LOUDNORM_TRUE_PEAK } from '@/core/qc/targets';

export const TRUE_PEAK_TOLERANCE = 0.1;
export const TRUE_PEAK_MARGIN = 0.2;
export const MAX_TRUE_PEAK_RETRIES = 2;
// loudnorm accepts TP in [-9, 0].
const MIN_CEILING = -9;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** The next ceiling after a pass whose encoded true peak was `measured`. */
export function nextCeiling(ceiling: number, measured: number, target = LOUDNORM_TRUE_PEAK): number {
  return Math.max(MIN_CEILING, round1(ceiling - (measured - target + TRUE_PEAK_MARGIN)));
}

export interface TruePeakGuardInput {
  /** Runs the normalisation pass with the given loudnorm ceiling (dBTP). */
  run: (ceiling: number) => Promise<void>;
  /** Measures the encoded output's true peak; absent where the adapter cannot (WASM, on-device). */
  measure?: () => Promise<number | null>;
  target?: number;
}

async function measureSafely(measure: TruePeakGuardInput['measure']): Promise<number | null> {
  if (!measure) return null;

  try {
    return await measure();
  } catch {
    return null;
  }
}

async function attempt(
  input: TruePeakGuardInput,
  ceiling: number,
  history: LoudnessReport['attempts']
): Promise<LoudnessReport> {
  const target = input.target ?? LOUDNORM_TRUE_PEAK;

  await input.run(ceiling);
  const measured = await measureSafely(input.measure);
  const attempts = [...history, { ceiling, measured }];
  const report: LoudnessReport = { filter: 'loudnorm', target, ceiling, measured, retries: history.length, attempts };

  if (measured === null || measured <= target + TRUE_PEAK_TOLERANCE || history.length >= MAX_TRUE_PEAK_RETRIES) {
    return report;
  }

  const lowered = nextCeiling(ceiling, measured, target);

  return lowered < ceiling ? attempt(input, lowered, attempts) : report;
}

/** Runs the loudnorm pass, re-running it with a lower ceiling while the encoded true peak overshoots. */
export function normalizeWithTruePeakGuard(input: TruePeakGuardInput): Promise<LoudnessReport> {
  return attempt(input, input.target ?? LOUDNORM_TRUE_PEAK, []);
}
