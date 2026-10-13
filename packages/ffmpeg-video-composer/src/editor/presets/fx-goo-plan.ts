// The goo fx's plan (fx-goo.ts lowers it, the builder's canvas preview samples it): every blob as x / y / r
// tracks in target px, the radius of the sprite they are scaled from and the union threshold. Authored
// `blobs` convert from target fractions; without them the seeded choreography (fx-goo-choreo.ts) plays.

import { fmt } from '@/core/motion/hermite';
import { resolveKeyTimes, type TrackKey } from '@/core/motion/tracks';
import { parseEasing } from '@/core/motion/easing';
import type { FxGraphicOf } from '../../schemas/fx.schemas';
import type { Region } from './fx-marks';
import { choreography, type Choreo } from './fx-goo-choreo';

export { GOO_POP_EASE } from './fx-goo-choreo';

type Graphic = FxGraphicOf<'goo'>;

/** One value track: its keys (px, absolute times) over a resting `base` (px). */
export interface Track {
  base: number;
  keys?: TrackKey[];
}

export interface GooBlob {
  x: Track;
  y: Track;
  r: Track;
}

export interface GooPlan {
  blobs: GooBlob[];
  /** The sprite's blob radius (the largest radius any blob reaches), px. */
  radius: number;
  /** Union threshold, 0..1. */
  threshold: number;
}

/** The union threshold of a goo amount (0.3..0.7, 0.5 by default). */
export function gooThreshold(amount: number | undefined): number {
  return 0.3 + 0.4 * (amount ?? 0.5);
}

function scaled(keys: TrackKey[] | undefined, factor: number): TrackKey[] | undefined {
  return keys?.map((key) => ({
    ...key,
    v:
      typeof key.v === 'number'
        ? key.v * factor
        : `${key.v.startsWith('-') ? '-' : '+'}${fmt(Math.abs(Number(key.v)) * factor)}`,
  }));
}

// Authored blobs: fractions of the target → px (x of its width, y of its height, r of its short side).
function authored(blobs: NonNullable<Graphic['blobs']>, w: number, h: number): GooBlob[] {
  const side = Math.min(w, h);

  return blobs.map((blob) => ({
    x: { base: blob.x * w, keys: scaled(blob.animate?.x, w) },
    y: { base: blob.y * h, keys: scaled(blob.animate?.y, h) },
    r: { base: blob.r * side, keys: scaled(blob.animate?.r, side) },
  }));
}

// Reduced motion: every authored blob at its base, or the choreography's whole blob at the centre.
function still(g: Graphic, w: number, h: number): GooBlob[] {
  if (g.blobs) {
    return authored(g.blobs, w, h).map((blob) => ({
      x: { base: blob.x.base },
      y: { base: blob.y.base },
      r: { base: blob.r.base },
    }));
  }

  return [{ x: { base: w / 2 }, y: { base: h / 2 }, r: { base: (g.size ?? 0.14) * Math.min(w, h) } }];
}

function moving(g: Graphic, w: number, h: number, c: Choreo): GooBlob[] {
  return g.blobs ? authored(g.blobs, w, h) : choreography(g, { w, h }, c);
}

/** The blobs in target px, the sprite radius and the threshold. */
export function gooPlan(
  g: Graphic,
  target: Region,
  time: { at: number; end: number } & Partial<Choreo> & { reduced?: boolean }
): GooPlan {
  const c: Choreo = {
    at: time.at,
    duration: time.duration ?? time.end - time.at,
    passes: time.passes ?? 1,
    every: time.every ?? time.end - time.at,
    ease: time.ease ?? 'linear',
    random: time.random ?? (() => 0.5),
  };
  const blobs = time.reduced ? still(g, target.w, target.h) : moving(g, target.w, target.h, c);
  const radius = Math.max(1, ...blobs.flatMap((blob) => values(blob.r)));

  return { blobs, radius: Math.round(radius), threshold: gooThreshold(g.goo) };
}

// The track's value at section time t, as its expression evaluates it (each key eases in from the previous).
function trackAt(track: Track, t: number): number {
  function value(v: number | string): number {
    return typeof v === 'number' ? v : track.base + Number(v);
  }

  const timed = resolveKeyTimes(track.keys ?? []);
  let out = timed.length > 0 ? value(timed[0].v) : track.base;

  for (let i = 1; i < timed.length; i++) {
    const [from, to] = [timed[i - 1], timed[i]];
    const p = Math.min(1, Math.max(0, (t - from.at) / (to.at - from.at)));
    const eased = to.ease === undefined || to.ease === 'linear' ? p : parseEasing(to.ease).fn(p);

    out += (value(to.v) - value(from.v)) * eased;
  }

  return out;
}

/** Every blob's centre and radius (target px) at section time t: what the render draws on that frame. */
export function blobsAt(plan: GooPlan, t: number): Array<{ cx: number; cy: number; r: number }> {
  return plan.blobs.map((blob) => ({
    cx: trackAt(blob.x, t),
    cy: trackAt(blob.y, t),
    r: Math.max(0, trackAt(blob.r, t)),
  }));
}

// Every value a track takes at its keys, px (relative keys resolved against the base).
export function values(track: Track): number[] {
  const keyed = (track.keys ?? []).map((k) => (typeof k.v === 'number' ? k.v : track.base + Number(k.v)));

  return [track.base, ...keyed];
}

function span(track: Track): [number, number] {
  const all = values(track);
  const [lo, hi] = [Math.min(...all), Math.max(...all)];
  // Room for an overshooting ease between keys.
  const slack = 0.08 * (hi - lo);

  return [lo - slack, hi + slack];
}

/** The frame-px box every blob stays in: centres ± the largest radius (with its overshoot) and 2 px. */
export function bounds(plan: GooPlan, target: Region): Region {
  const reach = plan.radius * 1.08 + 2;
  const xs = plan.blobs.flatMap((blob) => span(blob.x));
  const ys = plan.blobs.flatMap((blob) => span(blob.y));
  const [x0, x1] = [Math.min(...xs) - reach, Math.max(...xs) + reach];
  const [y0, y1] = [Math.min(...ys) - reach, Math.max(...ys) + reach];

  return { x: target.x + Math.floor(x0), y: target.y + Math.floor(y0), w: Math.ceil(x1 - x0), h: Math.ceil(y1 - y0) };
}
