// fx "confetti": a ballistic burst of tumbling paper pieces. Fields: schemas/fx-celebrate.schemas.ts.
//
// Each piece follows a closed-form flight (core/motion/ballistic.ts: launch velocity in a seeded cone,
// gravity, linear drag, a lateral sway) evaluated per frame in its overlay's x/y, so any frame renders on
// its own. It tumbles (rotate with a per-piece rate and sense) and flutters (a per-frame horizontal squash,
// |cos| of its flip phase: the foreshortening of a piece turning edge-on). Sprites are one solid,
// anti-aliased piece per (colour, shape) at the LARGEST size, split to their pieces and only scaled down:
// depth tiers at 0.6 / 0.8 / 1.0 size with slightly lower alpha further back. Pieces ramp in over 4 frames
// and fade out over the last `fade` seconds. At most 36 overlays per graphic (repeats share them); the
// region is the whole frame. Reduced motion: a still scatter of up to 12 pieces fading in and out.

import type { Filter } from '@/core/types';
import { ballisticApex, ballisticAt, ballisticExpr, type Ballistic } from '@/core/motion/ballistic';
import { fmt } from '@/core/motion/hermite';
import type { FxContext, FxEffect, FxLayer } from './fx-kit';
import type { SpriteSpec } from './fx-sprites';
import {
  alphaScale,
  centredAt,
  drawInFrame,
  even,
  fadeIn,
  fadeOut,
  frameScale,
  rampOf,
  scaleTo,
  sizeExpr,
  spriteHex,
  spriteStream,
  themeColors,
} from './fx-marks';

type Ctx = FxContext<'confetti'>;

/** The overlay budget of one confetti graphic, every pass included. */
export const CONFETTI_BUDGET = 36;
/** A piece's long side in px at 1080p: big enough to read as paper at phone scale. */
export const DEFAULT_SIZE = 28;
const REDUCED_PIECES = 12;
const TIERS = [
  { size: 0.4, alpha: 0.15 },
  { size: 0.2, alpha: 0.08 },
  { size: 0, alpha: 0 },
];
const PALETTE = ['accent', 'accent2', 'brand', 'fg'] as const;

export interface Piece {
  flight: Ballistic;
  /** The pass's launch time. */
  t0: number;
  sprite: string;
  /** Size as a share of the sprite, and alpha (depth tier). */
  scale: number;
  alpha: number;
  /** Initial angle (rad), tumble rate (rad/s), flutter rate (rad/s) and phase. */
  angle: number;
  spin: number;
  flutter: number;
  flip: number;
}

interface Burst {
  ox: number;
  oy: number;
  angle: number;
  spread: number;
  speed: number;
}

/** The palette as sprite hex colours: authored `colors`, else the theme's accent, accent2, brand and fg. */
export function confettiPalette(fx: Ctx): string[] {
  const authored = (fx.graphic.colors ?? []).flatMap((color) => spriteHex(color) ?? []);
  const colors = authored.length > 0 ? authored : themeColors(fx, PALETTE);

  return colors.length > 0 ? [...new Set(colors)] : ['ffffff'];
}

function burstOf(fx: Ctx): Burst {
  const g = fx.graphic;
  const { x, y, w, h } = fx.target;
  const spread = g.spread ?? 90 + fx.random() * 40;

  return {
    ox: x + (g.origin?.x ?? 0.5) * w,
    oy: y + (g.origin?.y ?? 0.5) * h,
    angle: ((g.angle ?? -90) * Math.PI) / 180,
    spread: (spread * Math.PI) / 180,
    speed: (g.speed ?? 1.5) * fx.frame.height,
  };
}

function flightOf(fx: Ctx, burst: Burst): Ballistic {
  const g = fx.graphic;
  const direction = burst.angle + (fx.random() - 0.5) * burst.spread;
  const speed = burst.speed * (0.75 + fx.random() * 0.5);

  return {
    x0: burst.ox,
    y0: burst.oy,
    vx: speed * Math.cos(direction),
    vy: speed * Math.sin(direction),
    gravity: (g.gravity ?? 1.6) * fx.frame.height,
    drag: (g.drag ?? 3.2) * (0.85 + fx.random() * 0.3),
    sway: (g.sway ?? 0.012) * fx.frame.width * (0.5 + fx.random()),
    swayRate: 0.8 + fx.random() * 0.8,
    swayPhase: fx.random() * 2 * Math.PI,
  };
}

// One piece; seeded draws in a fixed order: flight (6), shape, then angle, spin, flutter, flip.
function pieceOf(fx: Ctx, burst: Burst, slot: { i: number; t0: number; palette: string[] }): Piece {
  const flight = flightOf(fx, burst);
  const disc = fx.random() < (fx.graphic.discs ?? 0.2);
  const depth = fx.graphic.depth ?? 1;
  const tier = TIERS[slot.i % TIERS.length];
  const spin = (fx.graphic.spin ?? 1.4) * 2 * Math.PI * (0.4 + fx.random() * 0.6);

  return {
    flight,
    t0: slot.t0,
    sprite: `${disc ? 'd' : 'r'}${slot.palette[slot.i % slot.palette.length]}`,
    scale: 1 - depth * tier.size,
    alpha: 1 - depth * tier.alpha,
    angle: fx.random() * 2 * Math.PI,
    spin: fx.random() < 0.5 ? -spin : spin,
    flutter: 2 * Math.PI * (1.5 + fx.random() * 2),
    flip: fx.random() * Math.PI,
  };
}

/** Every piece of every pass that fits the 36-overlay budget, in a fixed seeded order. */
export function confettiPieces(fx: Ctx): Piece[] {
  const count = fx.graphic.count ?? 28 + Math.floor(fx.random() * 9);
  const burst = burstOf(fx);
  const palette = confettiPalette(fx);
  const starts = Array.from({ length: fx.passes }, (_, i) => fx.at + i * fx.every).filter((t0) => t0 < fx.end);
  const perPass = Math.max(1, Math.min(count, Math.floor(CONFETTI_BUDGET / starts.length)));
  const pieces = starts.flatMap((t0) =>
    Array.from({ length: perPass }, (_, i) => pieceOf(fx, burst, { i, t0, palette }))
  );

  return pieces.slice(0, fx.reduced ? Math.min(REDUCED_PIECES, perPass) : CONFETTI_BUDGET);
}

export function spriteOf(key: string, size: number): SpriteSpec {
  const disc = key.startsWith('d');
  const [w, h] = disc ? [even(size * 0.6), even(size * 0.6)] : [even(size), even(size / 2)];

  return { kind: 'piece', shape: disc ? 'disc' : 'rect', w, h, color: key.slice(1) };
}

/** Side of the square a sprite turns in (its diagonal), even. */
function turnSide(spec: SpriteSpec): number {
  return even(Math.hypot(spec.w, spec.h) + 2);
}

function motionFilters(fx: Ctx, piece: Piece, side: number): Filter[] {
  const T = `(t-${fmt(piece.t0)})`;
  const fade = Math.min(fx.graphic.fade ?? 0.5, fx.duration / 2);
  const end = piece.t0 + fx.duration;
  const squash = `${fmt(piece.scale)}*max(0.18,abs(cos(${fmt(piece.flutter)}*${T}+${fmt(piece.flip)})))`;
  const turn: Filter[] = fx.has('rotate')
    ? [{ type: 'rotate', value: `a='${fmt(piece.angle)}+${fmt(piece.spin)}*${T}':c=none:ow=${side}:oh=${side}` }]
    : [];

  return [
    { type: 'trim', value: `start=${fmt(piece.t0)}:end=${fmt(end)}` },
    ...alphaScale(piece.alpha),
    fadeIn(fx, piece.t0, rampOf(fx)),
    ...fadeOut(fx, end - fade, fade),
    ...turn,
    scaleTo(sizeExpr(side, squash), sizeExpr(side, fmt(piece.scale))),
  ];
}

// Reduced motion: the piece at rest near the top of its flight, turned once, faded in then out.
function stillFilters(fx: Ctx, piece: Piece, side: number): Filter[] {
  const half = (fx.end - fx.at) / 2;
  const size = even(side * piece.scale);
  const turn: Filter[] = fx.has('rotate')
    ? [{ type: 'rotate', value: `a=${fmt(piece.angle)}:c=none:ow=${side}:oh=${side}` }]
    : [];

  return [
    ...alphaScale(piece.alpha),
    fadeIn(fx, fx.at, half),
    ...fadeOut(fx, fx.at + half, half),
    ...turn,
    { type: 'scale', value: `${size}:${size}` },
  ];
}

function position(fx: Ctx, piece: Piece): { x: string; y: string } {
  if (!fx.reduced) {
    const at = ballisticExpr(piece.flight, `(t-${fmt(piece.t0)})`);

    return centredAt(at.x, at.y);
  }

  const rest = ballisticAt(piece.flight, ballisticApex(piece.flight).T * 0.6);

  return centredAt(Math.round(rest.x), Math.round(rest.y));
}

function lower(fx: Ctx): FxLayer[] | null {
  if (!fx.has('scale')) return null;

  const pieces = confettiPieces(fx);
  const size = (fx.graphic.size ?? DEFAULT_SIZE) * frameScale(fx);

  drawInFrame(fx);

  const keys = [...new Set(pieces.map((piece) => piece.sprite))];
  const streams = keys.map((key) =>
    spriteStream(fx, key, spriteOf(key, size), pieces.filter((p) => p.sprite === key).length)
  );

  if (streams.some((stream) => !stream)) return null;

  const branches = new Map(keys.map((key, i) => [key, [...(streams[i]?.labels ?? [])]]));
  const layers = pieces.map((piece, i): FxLayer => {
    const side = turnSide(spriteOf(piece.sprite, size));
    const filters = fx.reduced ? stillFilters(fx, piece, side) : motionFilters(fx, piece, side);
    const label = `${fx.prefix}pc${i}`;

    return {
      chains: [{ inputs: [branches.get(piece.sprite)?.shift() as string], filters, outputs: [label] }],
      label,
      ...position(fx, piece),
    };
  });
  const prep = streams.flatMap((stream) => stream?.chains ?? []);

  return [{ ...layers[0], chains: [...prep, ...layers[0].chains] }, ...layers.slice(1)];
}

export const CONFETTI: FxEffect<'confetti'> = { lower };
