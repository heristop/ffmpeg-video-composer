// Footage editing math (clip range, speed ramps, freeze frames): pure and deterministic, shared by the
// segment lowering (editor/utils/footage-lowering.ts), the director's duration bookkeeping and the
// time-reference pass, so every consumer agrees on how long an edited clip runs.
//
// Time domains:
// - source time: seconds into the trimmed clip (0 = `clip.from`).
// - ramp time: output seconds after the speed ramp, before freeze holds.
// - section time: the final section timeline (ramp time plus every hold so far). Ramp keys and freeze
//   `at` are authored in section time; ramp keys are mapped back to ramp time by removing the holds of
//   the freezes before them (a key inside a hold lands on the frozen frame).
//
// A ramp is a speed curve over output time. Eased transitions are discretized into RAMP_STEPS constant
// pieces, so source time is a piecewise-linear function of output time: the video lowers to one setpts
// expression and the audio to one atempo per piece, and both consume exactly the same source.

import { parseEasing, type EasingSpec } from '../motion/easing';
import { SPEED_RAMP_PRESET_TABLE, type SpeedRampPreset } from './presets';

export const RAMP_STEPS = 8;

export interface RampKeyInput {
  at: number | string;
  speed: number;
  ease?: EasingSpec;
}

export interface FreezeInput {
  at: number | string;
  hold: number;
  flash?: boolean;
  audio?: 'silence' | 'continue';
}

export interface FootageOptions {
  duration?: number;
  clip?: { from?: number; to?: number };
  speedRamp?: SpeedRampPreset | RampKeyInput[];
  rampAudio?: 'stretch' | 'mute';
  freeze?: FreezeInput[];
}

export interface RampKey {
  at: number;
  speed: number;
  ease?: EasingSpec;
}

/** A constant-speed run: from output time `o0` (source time `s0`) until the next piece. */
export interface RampPiece {
  o0: number;
  s0: number;
  speed: number;
}

export interface FreezePlan {
  /** Section time of the held frame. */
  at: number;
  /** Frame index (on the conformed stream, holds before it included) that is held. */
  frame: number;
  /** Extra copies of that frame. */
  frames: number;
  flash: boolean;
  audio: 'silence' | 'continue';
}

export interface FootagePlan {
  /** Source in-point in seconds. */
  from: number;
  /** Source out-point in seconds, or undefined to run to the end of the clip. */
  to: number | undefined;
  /** Trimmed source length, when known. */
  span: number | undefined;
  /** Ramp pieces, or null without a ramp. */
  pieces: RampPiece[] | null;
  freezes: FreezePlan[];
  /** Edited length in section seconds (frame-quantized), when the source span is known. */
  length: number | undefined;
}

export function round6(value: number): number {
  return Number(value.toFixed(6));
}

/** True when the section uses any footage edit (clip range, speed ramp or freeze). */
export function hasFootageEdits(options: FootageOptions | undefined): boolean {
  if (!options) return false;

  return options.clip !== undefined || options.speedRamp !== undefined || (options.freeze?.length ?? 0) > 0;
}

// The eased speed sampled at each step's midpoint: the mean speed of every discretized piece.
function stepSpeeds(from: number, to: number, ease: EasingSpec | undefined): number[] {
  const fn = parseEasing(ease ?? 'linear').fn;

  return Array.from({ length: RAMP_STEPS }, (_, j) => round6(from + (to - from) * fn((j + 0.5) / RAMP_STEPS)));
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** A preset's keys in output seconds, for a trimmed source of `scale` seconds. */
export function presetRampKeys(preset: SpeedRampPreset, scale: number): RampKey[] {
  const table = SPEED_RAMP_PRESET_TABLE[preset].keys;
  const first = table[0];
  const keys: RampKey[] = [{ at: round6((first.p * scale) / first.speed), speed: first.speed }];

  for (let index = 1; index < table.length; index++) {
    const previous = table[index - 1];
    const key = table[index];
    const sourceSpan = (key.p - previous.p) * scale;
    const average = previous.speed === key.speed ? key.speed : mean(stepSpeeds(previous.speed, key.speed, key.ease));
    const at = round6((keys.at(-1) as RampKey).at + sourceSpan / average);

    keys.push({ at, speed: key.speed, ...(key.ease === undefined ? {} : { ease: key.ease }) });
  }

  return keys;
}

/** Ramp time of a section time: the holds of the freezes before it removed. */
export function rampTimeOf(sectionTime: number, freezes: readonly FreezePlan[], fps: number): number {
  let held = 0;

  for (const freeze of freezes) {
    const at = freeze.frame / fps;

    if (sectionTime > at) held += Math.min(sectionTime - at, freeze.frames / fps);
  }

  return round6(sectionTime - held);
}

/** The ramp's keys in ramp seconds, or null while an authored key time is still a reference. */
export function rampKeys(
  ramp: FootageOptions['speedRamp'],
  scale: number,
  toRampTime: (sectionTime: number) => number = (time) => time
): RampKey[] | null {
  if (typeof ramp === 'string') {
    return Object.hasOwn(SPEED_RAMP_PRESET_TABLE, ramp) ? presetRampKeys(ramp, scale) : null;
  }

  // Raw descriptors reach this through the timing pass before validation, so a key may be anything.
  const keys = (Array.isArray(ramp) ? ramp : []) as unknown[];

  if (keys.length === 0 || keys.some((key) => typeof (key as Partial<RampKeyInput> | null)?.at !== 'number')) {
    return null;
  }

  return (keys as RampKeyInput[]).map((key) => ({ ...key, at: toRampTime(key.at as number) }));
}

function pushPiece(pieces: Array<{ o0: number; speed: number }>, at: number, speed: number): void {
  const last = pieces.at(-1);
  const o0 = round6(at);

  if (last?.speed === speed) return;

  if (last?.o0 === o0) {
    last.speed = speed;

    return;
  }

  pieces.push({ o0, speed });
}

/** Constant-speed pieces of a ramp, with the source time each one starts at. */
export function rampPieces(keys: readonly RampKey[]): RampPiece[] {
  const runs: Array<{ o0: number; speed: number }> = [{ o0: 0, speed: keys[0].speed }];

  for (let index = 1; index < keys.length; index++) {
    const a = keys[index - 1];
    const b = keys[index];

    if (a.speed !== b.speed) {
      const window = b.at - a.at;

      for (const [j, speed] of stepSpeeds(a.speed, b.speed, b.ease).entries()) {
        pushPiece(runs, a.at + (window * j) / RAMP_STEPS, speed);
      }
    }

    pushPiece(runs, b.at, b.speed);
  }

  let s0 = 0;

  return runs.map((run, index) => {
    const piece = { o0: run.o0, s0: round6(s0), speed: run.speed };

    if (index + 1 < runs.length) s0 += (runs[index + 1].o0 - run.o0) * run.speed;

    return piece;
  });
}

// The last piece matching `test` (pieces are ordered in both time domains); the first piece otherwise.
function lastPiece(pieces: readonly RampPiece[], test: (piece: RampPiece) => boolean): RampPiece {
  let found = pieces[0];

  for (const piece of pieces) {
    if (test(piece)) found = piece;
  }

  return found;
}

function pieceAtSource(pieces: readonly RampPiece[], source: number): RampPiece {
  return lastPiece(pieces, (piece) => piece.s0 < source);
}

/** Output seconds the ramp takes to play `span` seconds of source. */
export function rampLength(pieces: readonly RampPiece[], span: number): number {
  const piece = pieceAtSource(pieces, span);

  return round6(piece.o0 + (span - piece.s0) / piece.speed);
}

/** Source time reached at output time `output`. */
export function sourceAt(pieces: readonly RampPiece[], output: number): number {
  const piece = lastPiece(pieces, (candidate) => candidate.o0 <= output);

  return round6(piece.s0 + (output - piece.o0) * piece.speed);
}

function freezePlans(freeze: FreezeInput[] | undefined, fps: number): FreezePlan[] | null {
  const entries = (freeze ?? []) as unknown[];

  if (entries.some((entry) => typeof (entry as Partial<FreezeInput> | null)?.at !== 'number')) return null;

  return (entries as FreezeInput[]).map((entry) => ({
    at: entry.at as number,
    frame: Math.round((entry.at as number) * fps),
    frames: Math.max(1, Math.round(entry.hold * fps)),
    flash: entry.flash ?? false,
    audio: entry.audio ?? 'silence',
  }));
}

function trimmedSpan(from: number, to: number | undefined, sourceLength: number | undefined): number | undefined {
  const available = sourceLength === undefined ? undefined : Math.max(0, sourceLength - from);

  if (to === undefined) return available;

  return round6(available === undefined ? to - from : Math.min(to - from, available));
}

/**
 * The edit plan for a section, or null while a time field is still an unresolved reference. The source
 * length is the probed clip length (project_video) or undefined when it is not probed (video sections);
 * a preset ramp then scales to `clip.to - clip.from`, else to `options.duration`.
 */
export function footagePlan(
  options: FootageOptions,
  sourceLength: number | undefined,
  fps: number
): FootagePlan | null {
  const from = options.clip?.from ?? 0;
  const span = trimmedSpan(from, options.clip?.to, sourceLength);
  const freezes = freezePlans(options.freeze, fps);

  if (freezes === null) return null;

  const keys = rampKeys(options.speedRamp, span ?? options.duration ?? 1, (time) => rampTimeOf(time, freezes, fps));

  if (options.speedRamp !== undefined && keys === null) return null;

  const pieces = keys ? rampPieces(keys) : null;

  return {
    from,
    to: span === undefined ? undefined : round6(from + span),
    span,
    pieces,
    freezes,
    length: planLength(span, pieces, freezes, fps),
  };
}

// Ramped clip on the frame grid, plus every hold.
function planLength(
  span: number | undefined,
  pieces: RampPiece[] | null,
  freezes: FreezePlan[],
  fps: number
): number | undefined {
  if (span === undefined) return undefined;

  const ramped = pieces === null ? span : rampLength(pieces, span);
  const holds = freezes.reduce((sum, entry) => sum + entry.frames, 0);

  return round6((Math.round(ramped * fps) + holds) / fps);
}

/** Edited section length, or undefined when it is unknown before rendering. */
export function footageLength(
  options: FootageOptions | undefined,
  sourceLength: number | undefined,
  fps: number
): number | undefined {
  if (!options || !hasFootageEdits(options)) return sourceLength;

  return footagePlan(options, sourceLength, fps)?.length;
}
