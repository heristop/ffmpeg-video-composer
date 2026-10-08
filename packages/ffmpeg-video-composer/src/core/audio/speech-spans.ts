// Voiced spans of a mono signal: 20 ms frames whose RMS sits within 30 dB of the loudest frame (and above
// -50 dBFS), short dips bridged and clicks dropped. A coarse voice-activity map, enough to tell where
// speech starts and where it resumes after a pause. Pure and deterministic.

const FRAME_SECONDS = 0.02;
const RELATIVE_DB = 30;
const FLOOR_DB = -50;
/** Gaps shorter than this are breaths inside a phrase, not pauses. */
const BRIDGE_SECONDS = 0.12;
/** Spans shorter than this are clicks. */
const MIN_SPAN_SECONDS = 0.06;

function frameLevels(samples: Float32Array, frame: number): number[] {
  const levels: number[] = [];

  for (let start = 0; start + frame <= samples.length; start += frame) {
    let energy = 0;

    for (let index = start; index < start + frame; index++) energy += samples[index] * samples[index];

    levels.push(10 * Math.log10(energy / frame + 1e-12));
  }

  return levels;
}

function voicedRuns(levels: readonly number[], threshold: number): Array<[number, number]> {
  const runs: Array<[number, number]> = [];

  for (const [index, level] of levels.entries()) {
    const last = runs.at(-1);

    if (level < threshold) continue;

    if (last?.[1] === index) last[1] = index + 1;

    if (last?.[1] !== index + 1) runs.push([index, index + 1]);
  }

  return runs;
}

function bridged(runs: Array<[number, number]>): Array<[number, number]> {
  const merged: Array<[number, number]> = [];

  for (const run of runs) {
    const last = merged.at(-1);

    if (last && (run[0] - last[1]) * FRAME_SECONDS < BRIDGE_SECONDS) last[1] = run[1];

    if (!last || last[1] !== run[1]) merged.push([...run]);
  }

  return merged;
}

// A loop, not Math.max(...levels): an hour of audio is 180k frames, past what a spread can pass.
function loudest(levels: readonly number[]): number {
  let peak = FLOOR_DB;

  for (const level of levels) peak = Math.max(peak, level);

  return peak;
}

/** [start, end] seconds of each voiced stretch. */
export function speechSpans(samples: Float32Array, sampleRate: number): Array<[number, number]> {
  const frame = Math.max(1, Math.round(sampleRate * FRAME_SECONDS));
  const levels = frameLevels(samples, frame);
  const peak = loudest(levels);

  if (peak <= FLOOR_DB) return [];

  const threshold = Math.max(FLOOR_DB, peak - RELATIVE_DB);

  return bridged(voicedRuns(levels, threshold))
    .filter(([start, end]) => (end - start) * FRAME_SECONDS >= MIN_SPAN_SECONDS)
    .map(([start, end]) => [Number((start * FRAME_SECONDS).toFixed(3)), Number((end * FRAME_SECONDS).toFixed(3))]);
}
