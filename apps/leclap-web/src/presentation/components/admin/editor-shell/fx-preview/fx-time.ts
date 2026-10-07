// Time sampling for the live effect preview: the same ramps and pass progress the engine's fx kit writes as
// fade filters and expressions (fx-kit.ts passProgress, fx-light-kit.ts envelope / ambientRamps), evaluated
// at one section time instead of per frame in FFmpeg. Pure.
import type { AnyFxContext } from 'ffmpeg-video-composer/src/editor/presets/fx-kit.ts';
import { parseEasing } from 'ffmpeg-video-composer/src/core/motion/easing.ts';

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** A linear fade in over [start, start + length] (1 after it). */
export function rampIn(t: number, start: number, length: number): number {
  return length <= 0 ? Number(t >= start) : clamp01((t - start) / length);
}

/** A linear fade out over [start, start + length] (1 before it). */
export function rampOut(t: number, start: number, length: number): number {
  return length <= 0 ? Number(t < start) : clamp01(1 - (t - start) / length);
}

/** Whether section time `t` lies in the effect's composite window (`enable=between(t,at,end)`). */
export function inWindow(fx: AnyFxContext, t: number): boolean {
  return t >= fx.at && t <= fx.end;
}

/** Seconds since the start of the pass that covers `t` (passes start `every` seconds apart). */
export function passTime(fx: AnyFxContext, t: number): number {
  const since = t - fx.at;

  return fx.passes > 1 ? since - Math.min(fx.passes - 1, Math.floor(since / fx.every)) * fx.every : since;
}

/** The start of the pass that covers `t`. */
export function passStart(fx: AnyFxContext, t: number): number {
  return t - passTime(fx, t);
}

/** Eased 0→1 progress of the current pass (held at 1 once the pass ends), or null outside the window. */
export function passProgress(fx: AnyFxContext, t: number): number | null {
  if (!inWindow(fx, t)) return null;

  return parseEasing(fx.ease).fn(clamp01(passTime(fx, t) / fx.duration));
}

/** The light kit's envelope: a double ramp in over `rise` of the window, a double ramp out over `fall`. */
export function lightEnvelope(fx: AnyFxContext, t: number, rise: number, fall: number): number {
  const life = fx.end - fx.at;
  const floor = 4 / fx.frame.fps;
  const up = Math.max(floor, life * rise);
  const down = Math.max(floor, Math.min(life - up, life * fall));

  return (
    rampIn(t, fx.at, up) *
    rampIn(t, fx.at, up * 0.6) *
    rampOut(t, fx.end - down, down) *
    rampOut(t, fx.end - down * 0.6, down * 0.6)
  );
}

/** The ambient ramps: a constant alpha with linear ramps of `seconds` at both ends. */
export function ambientEnvelope(fx: AnyFxContext, t: number, seconds: number): number {
  const life = fx.end - fx.at;
  const length = Math.max(4 / fx.frame.fps, Math.min(seconds, life / 2));

  return rampIn(t, fx.at, length) * rampOut(t, fx.end - length, length);
}

/** The reduced-motion stand-in's envelope: faded in over the first half of the window, out over the second. */
export function pulseEnvelope(fx: AnyFxContext, t: number): number {
  const half = (fx.end - fx.at) / 2;

  return rampIn(t, fx.at, half) * rampOut(t, fx.at + half, half);
}

/** Lead-in and tail around an effect window when the canvas loops it on its own (no playhead running). */
const LEAD = 0.35;
const TAIL = 0.5;
/** The longest loop: an ambient effect that spans the section loops its first seconds. */
const MAX_LOOP = 8;

/** The span of section time the canvas loops over to replay [from, to]: a short lead-in, the window, a tail. */
export function loopSpan(from: number, to: number, sectionSeconds: number): [number, number] {
  const start = Math.max(0, from - LEAD);
  const end = Math.min(Math.max(to + TAIL, start + 1), start + MAX_LOOP);

  return [start, sectionSeconds > start ? Math.min(end, Math.max(sectionSeconds, start + 1)) : end];
}

/** Section time at `elapsed` seconds of a loop over `span`. */
export function loopTime(span: [number, number], elapsed: number): number {
  const length = Math.max(0.1, span[1] - span[0]);

  return span[0] + (((elapsed % length) + length) % length);
}
