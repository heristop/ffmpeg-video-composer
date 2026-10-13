// Where the overlay draws a keyframed layer (layer-keyframes.ts). The x / y tracks move the resting
// top-left corner (options.position); a scale or turn changes the leg frame's size every frame, so the
// overlay places that frame by the chosen origin of the resting box instead, which then stays put:
//
// - scale only: the origin (ax, ay) of the box is pinned, x = rest + ax·W − ax·w (w = the scaled frame).
// - with a turn: the frame is a square centred on the box centre. The centre orbits the origin by the
//   rotated (and screen-space scaled) offset d = ((½ − ax)·W, (½ − ay)·H), clockwise on screen:
//   centre = origin + S·R(θ)·d, and the frame is drawn at centre − (w, h)/2.

import { fmt } from '@/core/motion/hermite';
import { trackExpr } from '@/core/motion/tracks';
import type { LayerAnimate, LayerOrigin } from '../../schemas/layer-animate.schemas';
import type { OverlayMotion } from '../utils/input-sources';

export interface Box {
  w: number;
  h: number;
}

interface PositionInput {
  position?: string;
  animate?: LayerAnimate;
  origin?: LayerOrigin;
}

interface PositionTransform {
  box: Box | null;
  turn: string | number | null;
  scale: { x: string; y: string } | null;
}

const ORIGIN_POINTS: Record<LayerOrigin, readonly [number, number]> = {
  center: [0.5, 0.5],
  'top-left': [0, 0],
  top: [0.5, 0],
  'top-right': [1, 0],
  left: [0, 0.5],
  right: [1, 0.5],
  'bottom-left': [0, 1],
  bottom: [0.5, 1],
  'bottom-right': [1, 1],
};

const NUMBER = /^-?\d+(?:\.\d+)?$/;

// An authored position's w / h (the overlay frame) read as the resting box: with a scale or a turn the
// frame changes size every frame, the rest does not.
function restingBox(value: string, box: Box): string {
  return value.replace(/\b(?:overlay_w|w)\b/g, String(box.w)).replace(/\b(?:overlay_h|h)\b/g, String(box.h));
}

function restOf(position: string | undefined, box: Box | null): [string, string] {
  const [x = '0', y = '0'] = (position ?? '0:0').split(':');

  if (!box) return [x, y];

  return [restingBox(x, box), restingBox(y, box)];
}

// base + offset, folded when the base is a plain number.
function plus(base: string, offset: number): string {
  if (NUMBER.test(base)) return fmt(Number(base) + offset);

  if (fmt(offset) === '0') return base;

  return offset < 0 ? `(${base})-${fmt(-offset)}` : `(${base})+${fmt(offset)}`;
}

// "+c*expr" / "-c*expr", "" for a zero coefficient.
function signed(coefficient: number, expr: string): string {
  const size = fmt(Math.abs(coefficient));

  if (size === '0') return '';

  const sign = coefficient < 0 ? '-' : '+';

  return size === '1' ? `${sign}${expr}` : `${sign}${size}*${expr}`;
}

// The share of the frame size to step back from the pinned point: "-w/2", "-w", "".
function backBy(share: number, size: 'w' | 'h'): string {
  if (share === 0) return '';

  if (share === 0.5) return `-${size}/2`;

  return share === 1 ? `-${size}` : `-${fmt(share)}*${size}`;
}

// The rotated offset (dx, dy) as [x, y] terms, scaled by the screen-space factors.
function orbit(d: [number, number], turn: string | number, factors: [string | null, string | null]): [string, string] {
  const [dx, dy] = d;

  if (typeof turn === 'number') {
    const [c, s] = [Math.cos((turn * Math.PI) / 180), Math.sin((turn * Math.PI) / 180)];
    const offsets = [dx * c - dy * s, dx * s + dy * c];

    return [signed(offsets[0], `(${factors[0]})`), signed(offsets[1], `(${factors[1]})`)];
  }

  const angle = `(${turn})*PI/180`;
  const terms = [
    `${signed(dx, `cos(${angle})`)}${signed(-dy, `sin(${angle})`)}`,
    `${signed(dx, `sin(${angle})`)}${signed(dy, `cos(${angle})`)}`,
  ];

  return [scaled(terms[0], factors[0]), scaled(terms[1], factors[1])];
}

function scaled(terms: string, factor: string | null): string {
  if (terms === '' || factor === null) return terms;

  return `+(${factor})*(${terms.replace(/^\+/, '')})`;
}

function turned(base: [string, string], box: Box, origin: readonly [number, number], transform: PositionTransform) {
  const [ax, ay] = origin;
  const d: [number, number] = [(0.5 - ax) * box.w, (0.5 - ay) * box.h];
  const turn = transform.turn as string | number;
  const factors: [string | null, string | null] = [transform.scale?.x ?? null, transform.scale?.y ?? null];

  // A constant turn of an unscaled layer folds its whole offset into the pinned point.
  if (typeof turn === 'number' && transform.scale === null) {
    const rad = (turn * Math.PI) / 180;
    const offset = [d[0] * Math.cos(rad) - d[1] * Math.sin(rad), d[0] * Math.sin(rad) + d[1] * Math.cos(rad)];

    return { x: `${plus(base[0], ax * box.w + offset[0])}-w/2`, y: `${plus(base[1], ay * box.h + offset[1])}-h/2` };
  }

  const [ox, oy] = orbit(d, turn, factors);

  return { x: `${plus(base[0], ax * box.w)}${ox}-w/2`, y: `${plus(base[1], ay * box.h)}${oy}-h/2` };
}

/** The resting position "x:y", the overlay frame's w / h read as the box. */
export function restPosition(options: PositionInput, transform: PositionTransform): string {
  return restOf(options.position, transform.box).join(':');
}

/**
 * The overlay x / y expressions, given the entrance motion lowered from the resting position. A track
 * overrides the entrance on its axis.
 */
export function placeLayer(
  options: PositionInput,
  transform: PositionTransform,
  motion: OverlayMotion
): { x: string; y: string } {
  const [rx, ry] = restOf(options.position, transform.box);
  const animate = options.animate ?? {};
  const base: [string, string] = [
    animate.x ? trackExpr(animate.x, rx) : (motion.x ?? rx),
    animate.y ? trackExpr(animate.y, ry) : (motion.y ?? ry),
  ];
  const { box } = transform;

  if (box === null || (transform.turn === null && transform.scale === null)) return { x: base[0], y: base[1] };

  const origin = ORIGIN_POINTS[options.origin ?? 'center'];

  if (transform.turn !== null) return turned(base, box, origin, transform);

  return {
    x: `${plus(base[0], origin[0] * box.w)}${backBy(origin[0], 'w')}`,
    y: `${plus(base[1], origin[1] * box.h)}${backBy(origin[1], 'h')}`,
  };
}
