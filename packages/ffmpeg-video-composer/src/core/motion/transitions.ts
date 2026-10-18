// Designed transitions (docs/plans/motion-system.md §4.3): eased, spring-capable boundaries.
//
// Instead of a per-pixel `xfade` expression (interpreted for every pixel of every frame: ~1 s per 720p
// frame), a designed boundary is cut into the outgoing tail and the incoming head, composed with filters
// whose geometry is evaluated once per frame (crop / overlay positions, zoompan), and concatenated back:
//
//   [left] → head ‖ tail ─┐
//                          ├─ compose(tail, in) → mix ─┐
//   [next] → in ‖ rest ────┘                           ├─ concat(head, mix, rest)
//
// Same timeline as xfade (offset + duration), so the audio crossfade and music windows are unchanged.
// Only standard filters (split, trim, setpts, pad, overlay, crop, scale, format, zoompan, xfade, concat, gblur;
// color/alphamerge for an iris with an origin, an ease, a rim or a shape; the drip adds gradients, color, lutyuv,
// drawbox, alphamerge and loop: transition-drip.ts; bands add rotate and loop: transition-bands.ts), all in the
// on-device build. A shaped iris and a zoom-through `through` a window read a compile-time matte image
// (transition-mattes.ts) the assembly adds as an input.

import { parseEasing, type EasingSpec } from './easing';
import { easedProgressExpr, fmt } from './hermite';
import { whipBlur, WHIP_EASE } from './whip';
import { exactZoomFilters, ZOOM_TIME } from './zoom-exact';
import { DEFAULT_TRANSITION_EASE, type DesignedTransition } from './transition-names';

export {
  DEFAULT_TRANSITION_EASE,
  DESIGNED_TRANSITIONS,
  isDesignedTransition,
  type DesignedTransition,
} from './transition-names';
import { dripGraph, DRIP_FALLBACK_COLOR, hexSource } from './transition-drip';
import { fnv1a32 } from '../determinism/hash';
import { bandsGraph } from './transition-bands';
import { throughGraph, type ThroughMatte } from './transition-through';
import { FIELD_LEVELS, SHAPE_FIELD_DIVISOR, type MatteShape } from './radial-matte';

export const DESIGNED_TRANSITION_DESCRIPTIONS: Record<DesignedTransition, string> = {
  'push-left': 'The next scene pushes the current one out to the left, both moving together.',
  'push-right': 'The next scene pushes the current one out to the right.',
  'push-up': 'The next scene pushes the current one up and out.',
  'push-down': 'The next scene pushes the current one down and out.',
  'swipe-left': 'The next scene slides over from the right while the current one drifts left beneath it.',
  'swipe-right': 'The next scene slides over from the left while the current one drifts right beneath it.',
  'zoom-through':
    'The camera flies through the current scene into the next: scale up, cross, settle; with `through`, into a ' +
    "letter's counter or a shape that frames the next scene.",
  iris:
    'A circle (or a star, heart or rounded square: shape) opens to reveal the next scene: from the centre, ' +
    'linearly, unless origin or ease is set.',
  'whip-left': 'A whip pan: the next scene pushes in from the right, motion-blurred along the travel at peak speed.',
  'whip-right': 'A whip pan to the right: the next scene pushes in from the left, motion-blurred at peak speed.',
  'whip-up': 'A vertical whip: the next scene pushes in from below, motion-blurred along the travel.',
  'whip-down': 'A vertical whip: the next scene pushes in from above, motion-blurred along the travel.',
  drip:
    'Paint runs down in drips of different lengths and covers the frame, then the next scene drips down over it ' +
    '(color: the paint, default the theme accent).',
  bands:
    'Parallel colour bands sweep in at an angle, staggered, cover the frame, then sweep on out to uncover the ' +
    'next scene (count, angle, colors, stagger).',
};

/** A point of the frame in fractions: 0 = left / top edge, 1 = right / bottom edge. */
export interface FramePoint {
  x: number;
  y: number;
}

export interface DesignedBoundary {
  type: DesignedTransition;
  ease?: EasingSpec;
  /** Iris only: where the circle opens from (default the centre). */
  origin?: FramePoint;
  /** Iris only: a #RRGGBB outline on the circle's edge (default none). */
  rim?: string;
  /** Drip only: the paint colour (hex; default the brand lavender, the director passes the theme accent). */
  color?: string;
  /** Iris only: the opening's shape (default circle: the circle paths, unchanged). */
  shape?: MatteShape;
  /** A shaped iris's reveal field or a zoom-through's window: the matte input (transition-mattes.ts). */
  matte?: ThroughMatte;
  /** Bands only. */
  count?: number;
  angle?: number;
  colors?: readonly string[];
  stagger?: number;
  /** Graph labels, without brackets. */
  left: string;
  right: string;
  out: string;
  /** Unique prefix for intermediate labels. */
  id: string;
  offset: number;
  duration: number;
  width: number;
  height: number;
  fps: number;
}

interface Pads {
  tail: string;
  in: string;
  mix: string;
}

type PushType = 'push-left' | 'push-right' | 'push-up' | 'push-down';

function push(b: DesignedBoundary, p: Pads, e: string, type: PushType): string {
  const { width: w, height: h } = b;
  const table = {
    'push-left': [`pad=${2 * w}:${h}:0:0`, `x=${w}:y=0`, `x='${w}*(${e})':y=0`],
    'push-right': [`pad=${2 * w}:${h}:${w}:0`, 'x=0:y=0', `x='${w}*(1-(${e}))':y=0`],
    'push-up': [`pad=${w}:${2 * h}:0:0`, `x=0:y=${h}`, `x=0:y='${h}*(${e})'`],
    'push-down': [`pad=${w}:${2 * h}:0:${h}`, 'x=0:y=0', `x=0:y='${h}*(1-(${e}))'`],
  } as const;
  const [pad, place, crop] = table[type];

  return `[${p.tail}]${pad}[${b.id}p];[${b.id}p][${p.in}]overlay=${place}[${b.id}s];[${b.id}s]crop=${w}:${h}:${crop}[${p.mix}]`;
}

function swipe(b: DesignedBoundary, p: Pads, e: string): string {
  const { width: w, height: h } = b;
  const drift = Math.round(w * 0.3);

  if (b.type === 'swipe-left') {
    return (
      `[${p.tail}]pad=${w + drift}:${h}:0:0,crop=${w}:${h}:x='${drift}*(${e})':y=0[${b.id}a];` +
      `[${b.id}a][${p.in}]overlay=x='${w}*(1-(${e}))':y=0[${p.mix}]`
    );
  }

  return (
    `[${p.tail}]pad=${w + drift}:${h}:${drift}:0,crop=${w}:${h}:x='${drift}*(1-(${e}))':y=0[${b.id}a];` +
    `[${b.id}a][${p.in}]overlay=x='-${w}*(1-(${e}))':y=0[${p.mix}]`
  );
}

// The exact sub-pixel zoom (zoom-exact.ts): a whole-pixel crop would step visibly as the zoom slows down.
// Zoom 1 stays the identity (no rest over-scan): the tail starts and the incoming lands on the untouched
// picture the neighbouring frames show.
function zoomChain(zoom: string, b: DesignedBoundary): string {
  const { width, height, fps } = b;

  return `${exactZoomFilters({ zoom }, { width, height, fps, identityAtRest: true }).join(',')},settb=AVTB`;
}

function zoomThrough(b: DesignedBoundary, p: Pads): string {
  const ease = parseEasing(b.ease ?? DEFAULT_TRANSITION_EASE);
  const e = easedProgressExpr(ease, { delay: 0, duration: b.duration }, `(${ZOOM_TIME})`);

  return (
    `[${p.tail}]${zoomChain(`1+0.6*(${e})`, b)}[${b.id}za];[${p.in}]${zoomChain(`1.25-0.25*(${e})`, b)}[${b.id}zb];` +
    `[${b.id}za][${b.id}zb]xfade=transition=fade:duration=${fmt(b.duration)}:offset=0[${p.mix}]`
  );
}

/** The iris mask is drawn at this fraction of the frame size, then scaled up (its edge softens with it). */
const IRIS_MASK_DIVISOR = 4;
/** Width of the mask's edge ramp, in mask px (~6 px at full size). */
const IRIS_SOFT = 1.5;
/** Half the rim's width, in mask px (the ring is ~8 px wide at full size before its soft edges). */
const IRIS_RIM = 1;

function even(value: number): number {
  return 2 * Math.round(value / 2);
}

interface MaskFrame {
  b: DesignedBoundary;
  /** The mask's size, px. */
  size: [number, number];
  /** The setpts that puts a branch on the frame grid. */
  grid: string;
}

// One per-pixel mask at mask size: `expr` is its signed distance to the edge (mask px), softened, scaled up.
function maskChain(m: MaskFrame, name: string, expr: string): string {
  const { b } = m;
  const d = fmt(b.duration);
  const source = `color=c=black:s=${m.size[0]}x${m.size[1]}:r=${b.fps}:d=${d},format=gray`;
  const id = `${b.id}${name}`;

  return (
    `${source}[${id}0];${source}[${id}1];` +
    `[${id}0][${id}1]xfade=transition=custom:expr='255*clip(${expr}/${fmt(IRIS_SOFT)}+0.5,0,1)'` +
    `:duration=${d}:offset=0,scale=${b.width}:${b.height}:flags=bilinear,format=gray,settb=AVTB,${m.grid}`
  );
}

// An iris from `origin` on the eased curve. A full-size per-pixel xfade expression costs ~0.8 s per 720p
// frame, so only the mask is per-pixel, at a quarter of the frame size (1/16 of the pixels): a disc of
// radius reach × e(t) around the origin, where reach is the origin's farthest frame corner. It is scaled
// up and becomes the incoming scene's alpha over the outgoing one. xfade's P runs 1 → 0, so the elapsed
// time is duration × (1 − P). A `rim` adds a second mask, a ring on the disc's edge, as the alpha of a
// plain colour laid over the mix: the circle visibly grows out of the element it opens from.
function irisMask(b: DesignedBoundary, p: Pads): string {
  const origin = b.origin ?? { x: 0.5, y: 0.5 };
  const [mw, mh] = [even(b.width / IRIS_MASK_DIVISOR), even(b.height / IRIS_MASK_DIVISOR)];
  const [ox, oy] = [origin.x * mw, origin.y * mh];
  const reach = Math.hypot(Math.max(ox, mw - ox), Math.max(oy, mh - oy)) + IRIS_SOFT;
  const d = fmt(b.duration);
  const e = easedProgressExpr(parseEasing(b.ease ?? 'linear'), { delay: 0, duration: b.duration }, `(${d}*(1-P))`);
  const distance = `hypot(X-${fmt(ox)},Y-${fmt(oy)})`;
  const radius = `${fmt(reach)}*(${e})`;
  const id = b.id;
  // Every branch on one frame grid: after the trims, frames decoded on the mp4 timebase can sit 1 µs off the
  // mask's, and the overlay and alphamerge pair frames by timestamp, so every third frame reused a stale one.
  const grid = `setpts=N/(${b.fps}*TB)`;
  const mask = { b, size: [mw, mh] as [number, number], grid };
  const disc =
    `${maskChain(mask, 'm', `(${radius}-${distance})`)}[${id}mask];[${p.in}]${grid}[${id}ig];` +
    `[${id}ig][${id}mask]alphamerge[${id}ia];[${p.tail}]${grid}[${id}tg];`;

  // A rim that is not a hex colour (a template that skipped the schema) is dropped, never interpolated.
  const rim = hexSource(b.rim);

  if (!rim) return `${disc}[${id}tg][${id}ia]overlay=0:0[${p.mix}]`;

  const color = `color=c=${rim}:s=${b.width}x${b.height}:r=${b.fps}:d=${d},settb=AVTB,${grid}`;

  return (
    `${disc}${maskChain(mask, 'ring', `(${IRIS_RIM}-abs(${distance}-${radius}))`)}[${id}ringmask];` +
    `${color}[${id}rc];[${id}rc][${id}ringmask]alphamerge[${id}rim];` +
    `[${id}tg][${id}ia]overlay=0:0[${id}ov];[${id}ov][${id}rim]overlay=0:0[${p.mix}]`
  );
}

// A shaped iris from its reveal field (radial-matte.ts): the field codes, per mask pixel, the scale the shape
// must reach to cover it (16-bit, 0..FIELD_LEVELS over the scale that covers the frame), so the frame's mask
// is one comparison per pixel against the eased level, on an xfade like the circle's, at half size. Like the
// circle's mask, every branch is restamped on one frame grid so the alphamerge and overlay never pair a
// stale mask frame. A shaped iris draws no rim (`rim` outlines the circle only).
function irisShaped(b: DesignedBoundary, p: Pads, matte: ThroughMatte): string {
  const [mw, mh] = [even(b.width / SHAPE_FIELD_DIVISOR), even(b.height / SHAPE_FIELD_DIVISOR)];
  const soft = (FIELD_LEVELS * IRIS_SOFT) / matte.scale;
  const d = fmt(b.duration);
  const e = easedProgressExpr(parseEasing(b.ease ?? 'linear'), { delay: 0, duration: b.duration }, `(${d}*(1-P))`);
  const level = `(${fmt(-soft / 2)}+${fmt(FIELD_LEVELS + soft)}*(${e}))`;
  const expr = `${FIELD_LEVELS}*clip((${level}-A)/${fmt(soft)}+0.5,0,1)`;
  const id = b.id;
  const grid = `setpts=N/(${b.fps}*TB)`;

  return (
    `[${matte.label}]format=gray16le,setsar=1,setpts=PTS-STARTPTS[${id}m0];` +
    `color=c=black:s=${mw}x${mh}:r=${b.fps}:d=${d},format=gray16le[${id}m1];` +
    `[${id}m0][${id}m1]xfade=transition=custom:expr='${expr}':duration=${d}:offset=0,format=gray,` +
    `scale=${b.width}:${b.height}:flags=bilinear,format=gray,settb=AVTB,${grid}[${id}mask];` +
    `[${p.in}]${grid}[${id}ic];[${p.tail}]${grid}[${id}tc];` +
    `[${id}ic][${id}mask]alphamerge[${id}ia];[${id}tc][${id}ia]overlay=0:0[${p.mix}]`
  );
}

// The built-in circle reveal (centred, linear) unless an origin, an ease or a rim asks for the mask, or a
// shape for its field (without its matte input, a shaped iris falls back to the circle).
function iris(b: DesignedBoundary, p: Pads): string {
  if (b.shape && b.shape !== 'circle' && b.matte) return irisShaped(b, p, b.matte);

  if (b.origin || b.ease || b.rim) return irisMask(b, p);

  return `[${p.tail}][${p.in}]xfade=transition=circleopen:duration=${fmt(b.duration)}:offset=0[${p.mix}]`;
}

// A whip is a push on a faster in-out curve, then a directional blur that follows its speed.
function whip(b: DesignedBoundary, p: Pads): string {
  const ease = b.ease ?? WHIP_EASE;
  const e = easedProgressExpr(parseEasing(ease), { delay: 0, duration: b.duration });
  const travel = b.type.replace('whip-', 'push-') as PushType;
  const moved = `${b.id}w`;
  const blur = whipBlur({ ease, duration: b.duration, fps: b.fps, width: b.width, height: b.height, type: b.type });

  return `${push(b, { ...p, mix: moved }, e, travel)};[${moved}]${blur}[${p.mix}]`;
}

function drip(b: DesignedBoundary, p: Pads): string {
  const { id, duration, fps, width, height, ease } = b;
  const color = b.color ?? DRIP_FALLBACK_COLOR;

  return dripGraph({ id, duration, fps, width, height, ease, color, seed: fnv1a32(id), ...p });
}

function compose(b: DesignedBoundary, p: Pads): string {
  if (b.type === 'drip') return drip(b, p);

  if (b.type === 'bands') return bandsGraph({ ...b, ...p });

  if (b.type === 'zoom-through' && b.matte) return throughGraph({ ...b, ...p }, b.matte);

  if (b.type === 'zoom-through') return zoomThrough(b, p);

  if (b.type === 'iris') return iris(b, p);

  if (b.type.startsWith('whip')) return whip(b, p);

  const e = easedProgressExpr(parseEasing(b.ease ?? DEFAULT_TRANSITION_EASE), { delay: 0, duration: b.duration });

  return b.type.startsWith('push') ? push(b, p, e, b.type as PushType) : swipe(b, p, e);
}

/** The filtergraph fragment for one designed boundary: [left] + [right] → [out]. */
export function designedTransitionGraph(b: DesignedBoundary): string {
  const id = b.id;
  const [off, end, d] = [fmt(b.offset), fmt(b.offset + b.duration), fmt(b.duration)];
  const pads: Pads = { tail: `${id}tail`, in: `${id}in`, mix: `${id}mix` };

  return [
    `[${b.left}]split=2[${id}l1][${id}l2]`,
    `[${b.right}]split=2[${id}r1][${id}r2]`,
    `[${id}l1]trim=end=${off},setpts=PTS-STARTPTS[${id}head]`,
    `[${id}l2]trim=start=${off}:end=${end},setpts=PTS-STARTPTS[${pads.tail}]`,
    `[${id}r1]trim=end=${d},setpts=PTS-STARTPTS[${pads.in}]`,
    `[${id}r2]trim=start=${d},setpts=PTS-STARTPTS[${id}rest]`,
    compose(b, pads),
    // One timebase everywhere (xfade refuses mixed ones; concat and zoompan each pick their own).
    `[${id}head][${pads.mix}][${id}rest]concat=n=3:v=1:a=0,settb=AVTB[${b.out}]`,
  ].join(';');
}
