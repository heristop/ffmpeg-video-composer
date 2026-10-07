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
// Only standard filters (split, trim, setpts, pad, overlay, crop, scale, format, zoompan, xfade, concat, gblur),
// all in the on-device build.

import { parseEasing, type EasingSpec } from './easing';
import { easedProgressExpr, fmt } from './hermite';
import { whipBlur, WHIP_EASE } from './whip';
import { exactZoomFilters, ZOOM_TIME } from './zoom-exact';

export const DESIGNED_TRANSITIONS = [
  'push-left',
  'push-right',
  'push-up',
  'push-down',
  'swipe-left',
  'swipe-right',
  'zoom-through',
  'iris',
  'whip-left',
  'whip-right',
  'whip-up',
  'whip-down',
] as const;

export type DesignedTransition = (typeof DESIGNED_TRANSITIONS)[number];

export const DESIGNED_TRANSITION_DESCRIPTIONS: Record<DesignedTransition, string> = {
  'push-left': 'The next scene pushes the current one out to the left, both moving together.',
  'push-right': 'The next scene pushes the current one out to the right.',
  'push-up': 'The next scene pushes the current one up and out.',
  'push-down': 'The next scene pushes the current one down and out.',
  'swipe-left': 'The next scene slides over from the right while the current one drifts left beneath it.',
  'swipe-right': 'The next scene slides over from the left while the current one drifts right beneath it.',
  'zoom-through': 'The camera flies through the current scene into the next: scale up, cross, settle.',
  iris: 'A circle opens from the centre to reveal the next scene (linear; ease is ignored).',
  'whip-left': 'A whip pan: the next scene pushes in from the right, motion-blurred along the travel at peak speed.',
  'whip-right': 'A whip pan to the right: the next scene pushes in from the left, motion-blurred at peak speed.',
  'whip-up': 'A vertical whip: the next scene pushes in from below, motion-blurred along the travel.',
  'whip-down': 'A vertical whip: the next scene pushes in from above, motion-blurred along the travel.',
};

/** Default transition curve: a symmetric, Apple-like ease-in-out. */
export const DEFAULT_TRANSITION_EASE = 'cubic-bezier(0.65, 0, 0.35, 1)';

export function isDesignedTransition(type: string): type is DesignedTransition {
  return (DESIGNED_TRANSITIONS as readonly string[]).includes(type);
}

export interface DesignedBoundary {
  type: DesignedTransition;
  ease?: EasingSpec;
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

// The built-in circle reveal: a per-pixel soft edge cost ~0.8 s per 720p frame, too slow for a phone.
function iris(b: DesignedBoundary, p: Pads): string {
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

function compose(b: DesignedBoundary, p: Pads): string {
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
