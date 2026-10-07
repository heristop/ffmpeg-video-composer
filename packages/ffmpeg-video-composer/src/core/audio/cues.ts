// Named moments of a music track from its loudness curve: `drop` (the largest energy rise, the moment the
// track lands after a build), `build` (where the sustained rise before the drop starts) and `end` (the
// last moment the music is still sounding). Pure and deterministic.

/** Loudness is pooled into blocks of this many seconds. */
const BLOCK = 0.1;
/** The rise at t compares the loudness of the RISE_WINDOW seconds after t with the seconds before it. */
const RISE_WINDOW = 2;
/** A drop needs at least this much rise, in dB. */
const MIN_DROP_DB = 6;
/** A build rises at least BUILD_SLOPE dB per BUILD_STEP seconds... */
const BUILD_STEP = 1;
const BUILD_SLOPE = 0.3;
/** ...for at least this long, and gains at least this much in total. */
const MIN_BUILD_SECONDS = 2;
const MIN_BUILD_DB = 3;
/** The music has ended once it stays this far below its loudest block. */
const END_BELOW_PEAK_DB = 40;

export interface MusicCues {
  build?: number;
  drop?: number;
  end: number;
}

function blocks(energy: Float64Array, rate: number): Float64Array {
  const size = Math.max(1, Math.round(BLOCK * rate));
  const out = new Float64Array(Math.ceil(energy.length / size));

  for (let block = 0; block < out.length; block++) {
    const slice = energy.subarray(block * size, Math.min(energy.length, (block + 1) * size));
    const power = slice.reduce((sum, db) => sum + 10 ** (db / 10), 0) / slice.length;

    out[block] = 10 * Math.log10(Math.max(power, 1e-10));
  }

  return out;
}

function mean(values: Float64Array, from: number, to: number): number {
  const slice = values.subarray(Math.max(0, from), Math.min(values.length, to));

  return slice.length > 0 ? slice.reduce((sum, value) => sum + value, 0) / slice.length : 0;
}

// Loudness of a stretch of blocks: their mean power, in dB (so silent gaps between hits do not count as
// -100 dB each).
function windowDb(power: Float64Array, from: number, to: number): number {
  return 10 * Math.log10(Math.max(1e-10, mean(power, from, to)));
}

function largestRise(loudness: Float64Array): { at: number; rise: number } {
  const span = Math.round(RISE_WINDOW / BLOCK);
  const power = loudness.map((db) => 10 ** (db / 10));
  let best = { at: 0, rise: -Infinity };

  for (let at = span; at + span <= loudness.length; at++) {
    const rise = windowDb(power, at, at + span) - windowDb(power, at - span, at);

    if (rise > best.rise) best = { at, rise };
  }

  return best;
}

// The sharpest single-block step near the window centre: where the drop actually hits.
function sharpestStep(loudness: Float64Array, around: number): number {
  const reach = Math.round(RISE_WINDOW / BLOCK / 2);
  let best = around;
  let bestStep = -Infinity;

  for (let at = Math.max(1, around - reach); at <= Math.min(loudness.length - 1, around + reach); at++) {
    const step = loudness[at] - loudness[at - 1];

    if (step > bestStep) {
      best = at;
      bestStep = step;
    }
  }

  return best;
}

// Centred moving average over ±half blocks.
function smooth(values: Float64Array, half: number): Float64Array {
  return values.map((_, index) => mean(values, index - half, index + half + 1));
}

function buildStart(raw: Float64Array, drop: number): number | undefined {
  const step = Math.round(BUILD_STEP / BLOCK);
  // Smoothed over ±0.5 s, and cut at the drop so the loud part does not leak back into the build.
  const loudness = smooth(raw.subarray(0, drop), Math.round(0.5 / BLOCK));
  const top = drop - 1;
  let start = top;

  while (start - step >= 0 && loudness[start - step] < loudness[start] - BUILD_SLOPE) start -= 1;

  const long = (top - start) * BLOCK >= MIN_BUILD_SECONDS;

  return long && loudness[top] - loudness[start] >= MIN_BUILD_DB ? start : undefined;
}

function musicEnd(loudness: Float64Array, duration: number): number {
  const peak = loudness.reduce((max, value) => Math.max(max, value), -Infinity);
  let last = loudness.length - 1;

  while (last > 0 && loudness[last] < peak - END_BELOW_PEAK_DB) last -= 1;

  return Math.min(duration, (last + 1) * BLOCK);
}

/** Cues of a track from its per-hop loudness in dB (`rate` hops per second), in seconds. */
export function findCues(energy: Float64Array, rate: number, duration: number): MusicCues {
  const loudness = blocks(energy, rate);
  const end = musicEnd(loudness, duration);
  const rise = largestRise(loudness);

  if (rise.rise < MIN_DROP_DB) return { end };

  const drop = sharpestStep(loudness, rise.at);
  const build = buildStart(loudness, drop);

  return { ...(build !== undefined && { build: build * BLOCK }), drop: drop * BLOCK, end };
}
