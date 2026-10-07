// The path model of the stroke graphics (frame, corners): an outline is an ordered list of pieces, each
// with a length along the path. Straight pieces are even-pixel drawbox rectangles that can be cut to any
// sub-span; rounded corners are quarter-arc sprites (compile-time, anti-aliased) that show whole once the
// drawn span covers their midpoint (an arc is a few px long: it is crossed within a frame or two). Pieces
// never overlap, so a colour with alpha (or a shadow) never doubles up where two pieces meet.

import type { Rect } from './graphics-spec';

export type Direction = '+x' | '-x' | '+y' | '-y';
export type Corner = 'tl' | 'tr' | 'br' | 'bl';

export interface LinePiece {
  kind: 'line';
  rect: Rect;
  /** Which way the path runs through it. */
  dir: Direction;
  length: number;
}

export interface ArcPiece {
  kind: 'arc';
  corner: Corner;
  /** Top-left of the arc's `size`×`size` box. */
  x: number;
  y: number;
  size: number;
  length: number;
}

export type Piece = LinePiece | ArcPiece;

/** A drawn stretch of a path, as fractions of its length (0 = start, 1 = end). */
export interface Span {
  from: number;
  to: number;
}

export function pathLength(pieces: readonly Piece[]): number {
  return pieces.reduce((sum, piece) => sum + piece.length, 0);
}

/** Straight piece from a rectangle; its length runs along `dir`. */
export function line(rect: Rect, dir: Direction): LinePiece {
  return { kind: 'line', rect, dir, length: dir.endsWith('x') ? rect.w : rect.h };
}

/** Corner piece of a `size` box at x/y: a quarter arc of radius `size` when `rounded`, else a plain square. */
export function corner(
  which: Corner,
  at: { x: number; y: number },
  size: number,
  thickness: number,
  rounded: boolean
): Piece {
  if (!rounded) return line({ x: at.x, y: at.y, w: size, h: size }, '+x');

  return { kind: 'arc', corner: which, ...at, size, length: (Math.PI / 2) * (size - thickness / 2) };
}

/** `a` minus `b` (both sorted, disjoint). */
export function subtract(a: readonly Span[], b: readonly Span[]): Span[] {
  return a.flatMap((span) => {
    let pieces: Span[] = [{ ...span }];

    for (const cut of b) {
      pieces = pieces.flatMap((piece) => {
        if (cut.to <= piece.from || cut.from >= piece.to) return [piece];

        return [
          { from: piece.from, to: cut.from },
          { from: cut.to, to: piece.to },
        ].filter((rest) => rest.to - rest.from > 1e-9);
      });
    }

    return pieces;
  });
}

/** The part of a straight piece between `a` and `b` px from its start. */
function cut(piece: LinePiece, a: number, b: number): Rect {
  const { x, y, w, h } = piece.rect;
  const len = b - a;
  const table: Record<Direction, Rect> = {
    '+x': { x: x + a, y, w: len, h },
    '-x': { x: x + w - b, y, w: len, h },
    '+y': { x, y: y + a, w, h: len },
    '-y': { x, y: y + h - b, w, h: len },
  };

  return table[piece.dir];
}

function snap(rect: Rect): Rect {
  const x = Math.round(rect.x);
  const y = Math.round(rect.y);

  return { x, y, w: Math.round(rect.x + rect.w) - x, h: Math.round(rect.y + rect.h) - y };
}

/** What `spans` of the path draw: rectangles (cut straight pieces) and the arcs whose midpoint is covered. */
export function drawn(pieces: readonly Piece[], spans: readonly Span[]): { rects: Rect[]; arcs: number[] } {
  const total = pathLength(pieces);
  const rects: Rect[] = [];
  const arcs: number[] = [];
  let start = 0;

  for (const [index, piece] of pieces.entries()) {
    const end = start + piece.length;

    for (const span of spans) {
      const [a, b] = [Math.max(start, span.from * total), Math.min(end, span.to * total)];
      const mid = (start + end) / 2;

      if (piece.kind === 'arc' && a <= mid && b >= mid) arcs.push(index);

      if (piece.kind === 'line' && b - a > 0) rects.push(snap(cut(piece, a - start, b - start)));
    }

    start = end;
  }

  return { rects: rects.filter((r) => r.w >= 1 && r.h >= 1), arcs: [...new Set(arcs)] };
}

/** Where each piece starts, as a fraction of the path (plus 1 at the end). */
export function pieceStarts(pieces: readonly Piece[]): number[] {
  const total = pathLength(pieces) || 1;
  let start = 0;

  return [
    ...pieces.map((piece) => {
      const at = start / total;
      start += piece.length;

      return at;
    }),
    1,
  ];
}
