// The drip transition (designed, transitions.ts): a wall of paint runs down over the outgoing scene in
// drips of seeded lengths with rounded ends, covers the frame at the midpoint, then the incoming scene runs
// down over the paint the same way (a second, differently seeded profile), so the cut hides under the paint.
//
// The LGPL device build has no per-pixel expression filter fast enough for a full frame (geq, blend), so the
// paint's shape is drawn ONCE, as a still: the drip SILHOUETTE at full extent, white on black, W × height.
// It is a rectangle (the wall, a little taller than the frame) united with ellipses centred on the wall's
// bottom edge: one per drip (half-width r, length L below the wall: the rounded end), a wider, shallow one
// around each drip (the shoulder where it leaves the wall) and a few broad ripples along the front. The
// ellipses are one anti-aliased disc (a radial `gradients` source thresholded by `lutyuv`, 1 px ramp) laid
// in white through its alpha, scaled per ellipse. Per frame, the still is scaled vertically to
// u × height (u = the stage's eased progress) and laid at the top of a black frame: a pixel is painted
// when y < u × G(x), G being the silhouette's per-column depth, so every drip grows with the wall, longer
// ones faster, and its rounded end stays round (squashed early on, like a drop gathering).
//
// Stages: the paint over [0, COVER × d], fully covering until REVEAL × d, then the incoming scene over
// [REVEAL × d, d], each on the transition ease. Filters: gradients, color, format, lutyuv, crop, alphamerge,
// split, scale (eval=frame), overlay, drawbox, loop, setpts, trim: all on the on-device allowlist. Cost per
// frame: two scales of the still, two overlays onto a black frame, two lutyuv, two alphamerges and two
// full-frame overlays (the silhouettes themselves are drawn on the first frame only).

import { fnv1a32, seededRandom } from '../determinism/hash';
import { parseEasing, type EasingSpec } from './easing';
import { easedProgressExpr, fmt } from './hermite';
import { parseHexColor } from '../theme/palette';

/** Share of the transition the paint takes to cover the frame; the incoming scene starts at REVEAL. */
export const DRIP_COVER = 0.46;
export const DRIP_REVEAL = 0.54;
/** Default paint when neither the transition nor the theme gives one (the brand lavender). */
export const DRIP_FALLBACK_COLOR = '#9298FB';
/** Default curve of each stage: in-out, so the paint lands on the midpoint and holds a beat. */
export const DRIP_EASE = 'cubic-bezier(0.55, 0, 0.35, 1)';

/** The disc every ellipse is cut from: its box side, and the gradients source it is thresholded from. */
const DISC = 200;
const GRADIENT = 256;
/** The wall runs this far below the frame, so a fully grown silhouette covers the last row. */
const WALL_OVERRUN = 0.04;

export interface Ellipse {
  /** Centre x and y, half-width and half-height, px. */
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface Drip {
  /** Centre x, half-width and length below the wall (to the bottom of the rounded end), px. */
  cx: number;
  radius: number;
  length: number;
}

export interface DripProfile {
  width: number;
  /** Silhouette height (wall + longest drip), even. */
  height: number;
  /** Depth of the wall, px (> the frame height). */
  wall: number;
  drips: Drip[];
  /** Every ellipse the silhouette unites with the wall: ripples, shoulders, then the drips' rounded ends. */
  ellipses: Ellipse[];
}

function even(value: number): number {
  return 2 * Math.max(1, Math.round(value / 2));
}

// Lengths spread over a ladder (short to nearly a frame), shuffled by the seed: neighbours never match.
function ladder(count: number, height: number, random: () => number): number[] {
  const steps = Array.from({ length: count }, (_, i) => height * (0.14 + (0.8 * i) / Math.max(1, count - 1)));

  for (let i = steps.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [steps[i], steps[j]] = [steps[j], steps[i]];
  }

  return steps.map((step) => step * (0.92 + random() * 0.16));
}

/** Half-height of a drip's rounded end: a little taller than round, so it reads round half-grown (the stage squashes it by u). */
export function dripEnd(drip: Drip): number {
  return Math.min(Math.round(drip.radius * 1.9), Math.round(drip.length / 2));
}

/** The seeded drip silhouette of a frame. */
export function dripProfile(frame: { width: number; height: number; seed: number }): DripProfile {
  const { width, height } = frame;
  const random = seededRandom(fnv1a32(`drip:${frame.seed}`));
  const count = Math.max(6, Math.round(width / (height * 0.17)));
  const pitch = width / count;
  const lengths = ladder(count, height, random);
  const drips = lengths.map((length, i) => ({
    cx: Math.round((i + 0.5) * pitch + (random() - 0.5) * 0.3 * pitch),
    radius: Math.round(pitch * (0.28 + random() * 0.12)),
    length: Math.round(length),
  }));
  const wall = Math.round(height * (1 + WALL_OVERRUN));
  const ripples = Array.from({ length: Math.ceil(count / 2) }, (_, i) => ({
    cx: Math.round((2 * i + 1 + random()) * pitch),
    cy: wall,
    rx: Math.round(pitch * (0.9 + random() * 0.5)),
    ry: Math.round(height * (0.012 + random() * 0.012)),
  }));
  // The shoulder: where a drip leaves the wall, the paint gathers in a shallow curve.
  const shoulders = drips.map((drip) => ({
    cx: drip.cx,
    cy: wall,
    rx: Math.round(drip.radius * 1.7),
    ry: Math.round(drip.radius * 0.7),
  }));
  const ends = drips.map((drip) => {
    const ry = dripEnd(drip);

    return { cx: drip.cx, cy: wall + drip.length - ry, rx: drip.radius, ry };
  });

  return {
    width,
    height: even(wall + Math.max(...drips.map((drip) => drip.length)) + 2),
    wall,
    drips,
    ellipses: [...ripples, ...shoulders, ...ends],
  };
}

export interface DripStage {
  /** Graph labels and the unique prefix of the stage's intermediate pads. */
  id: string;
  duration: number;
  fps: number;
  width: number;
  height: number;
}

/** One frame of a source, so the silhouettes are drawn once. */
function still(fps: number): string {
  return `r=${fps}:d=${fmt(1.5 / fps)}`;
}

/** The anti-aliased white disc (alpha) every ellipse is scaled from, split `count` ways. */
function discChains(id: string, fps: number, labels: string[]): string {
  const c = GRADIENT / 2;
  // value = 255 × (1 − d / 127.5) at d px from the centre: the disc edge sits at d = DISC / 2, 1 px ramp.
  const edge = Math.round(255 * (1 - DISC / 2 / (c - 0.5)));
  const pad = (GRADIENT - DISC) / 2;

  return (
    `gradients=s=${GRADIENT}x${GRADIENT}:c0=white:c1=black:x0=${c}:y0=${c}:x1=${GRADIENT - 1}:y1=${c}:` +
    `nb_colors=2:type=radial:speed=0:seed=0:${still(fps)},format=gray,` +
    `lutyuv=y='255*clip((val-${edge})/2+0.5,0,1)',crop=${DISC}:${DISC}:${pad}:${pad}[${id}dk];` +
    `color=c=white:s=${DISC}x${DISC}:${still(fps)}[${id}dw];` +
    `[${id}dw][${id}dk]alphamerge,split=${labels.length}${labels.map((label) => `[${label}]`).join('')}`
  );
}

/** The silhouette of `profile` as one still frame, looped over the stage, in [out] (yuv420p, 16..235). */
function silhouetteChains(profile: DripProfile, discs: string[], id: string, stage: DripStage): string {
  const { width, height, wall, ellipses } = profile;
  const frames = Math.round(stage.duration * stage.fps) - 1;
  // The wall, then each drip's body down to the centre of its rounded end (whole-pixel columns: the scale
  // is vertical only, so a body's sides stay crisp).
  const bodies = profile.drips.map((drip) => {
    const w = even(2 * drip.radius);

    return `drawbox=x=${Math.round(drip.cx - w / 2)}:y=0:w=${w}:h=${wall + drip.length - dripEnd(drip)}:color=white:t=fill`;
  });
  const canvas =
    `color=c=black:s=${width}x${height}:${still(stage.fps)},format=yuv420p,` +
    [`drawbox=x=0:y=0:w=${width}:h=${wall}:color=white:t=fill`, ...bodies].join(',') +
    `[${id}c0]`;
  const laid = ellipses.map((e, i) => {
    const [w, h] = [even(2 * e.rx), even(2 * e.ry)];

    return (
      `[${discs[i]}]scale=${w}:${h}[${id}e${i}];` +
      `[${id}c${i}][${id}e${i}]overlay=${Math.round(e.cx - w / 2)}:${Math.round(e.cy - h / 2)}[${id}c${i + 1}]`
    );
  });
  const looped = `[${id}c${ellipses.length}]trim=end_frame=1,loop=loop=${frames}:size=1:start=0,setpts=N/(${stage.fps}*TB)[${id}sil]`;

  return [canvas, ...laid, looped].join(';');
}

/**
 * The stage mask in [`out`] (gray, 0..255): the silhouette scaled to u × its height and laid at the top of a
 * black frame, u eased from 0 to 1 over [from, from + span] seconds of the stage.
 */
function maskChain(
  profile: DripProfile,
  id: string,
  stage: DripStage,
  timing: { from: number; span: number; ease: EasingSpec },
  out: string
): string {
  const u = easedProgressExpr(parseEasing(timing.ease), { delay: timing.from, duration: timing.span });
  const h = `max(2,2*trunc(${profile.height / 2}*(${u})+0.5))`;
  const black = `color=c=black:s=${stage.width}x${stage.height}:r=${stage.fps}:d=${fmt(stage.duration)}`;

  return (
    `[${id}sil]scale=w=${profile.width}:h='${h}':eval=frame:flags=bilinear[${id}sv];${black}[${id}bk];` +
    // A 2 px still is "nothing yet": it is laid above the frame.
    `[${id}bk][${id}sv]overlay=x=0:y='if(lte(overlay_h,2),-2,0)',` +
    `lutyuv=y='clip((val-16)*255/219,0,255)',format=gray[${out}]`
  );
}

export interface DripBoundary extends DripStage {
  tail: string;
  in: string;
  mix: string;
  color: string;
  ease?: EasingSpec;
  /** Seeds the two profiles (the boundary's own id, so neighbouring drips differ). */
  seed: number;
}

/** A hex colour (`#rgb`, `#rrggbb`, `0x…`, any `@alpha`) as a `color` source value `0xRRGGBB`; null otherwise. */
export function hexSource(color: string | undefined): string | null {
  const rgb = parseHexColor(color ?? '');

  if (!rgb) return null;

  return `0x${rgb.map((channel) => channel.toString(16).padStart(2, '0').toUpperCase()).join('')}`;
}

/**
 * The paint as the `color` source accepts it. Anything but a hex colour (a name, a CSS function,
 * filtergraph syntax from a template that skipped the schema) falls back to the default paint, so the
 * value can never leave the `color` option.
 */
function sourceColor(color: string): string {
  return hexSource(color) ?? `0x${DRIP_FALLBACK_COLOR.slice(1)}`;
}

/** The drip's compose step: [tail] + [in] → [mix]. */
export function dripGraph(b: DripBoundary): string {
  const id = b.id;
  const ease = b.ease ?? DRIP_EASE;
  const paint = dripProfile({ width: b.width, height: b.height, seed: b.seed });
  const reveal = dripProfile({ width: b.width, height: b.height, seed: b.seed + 1 });
  const discs = [...paint.ellipses, ...reveal.ellipses].map((_, i) => `${id}d${i}`);
  const first = discs.slice(0, paint.ellipses.length);
  const second = discs.slice(paint.ellipses.length);
  const cover = { from: 0, span: DRIP_COVER * b.duration, ease };
  const enter = { from: DRIP_REVEAL * b.duration, span: (1 - DRIP_REVEAL) * b.duration, ease };
  const source = `color=c=${sourceColor(b.color)}:s=${b.width}x${b.height}:r=${b.fps}:d=${fmt(b.duration)}`;

  return [
    discChains(id, b.fps, discs),
    silhouetteChains(paint, first, `${id}p`, b),
    silhouetteChains(reveal, second, `${id}q`, b),
    maskChain(paint, `${id}p`, b, cover, `${id}k1`),
    maskChain(reveal, `${id}q`, b, enter, `${id}k2`),
    `${source}[${id}paint];[${id}paint][${id}k1]alphamerge[${id}pa]`,
    `[${b.in}][${id}k2]alphamerge[${id}ia]`,
    `[${b.tail}][${id}pa]overlay=0:0[${id}s1];[${id}s1][${id}ia]overlay=0:0[${b.mix}]`,
  ].join(';');
}
