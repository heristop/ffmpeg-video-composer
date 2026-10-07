// The outlines of the stroke graphics as paths (stroke-path.ts): a frame is one closed path that starts
// at the top-left and runs clockwise; corners are four short paths (top-left, top-right, bottom-right,
// bottom-left), each running from one arm tip through the elbow to the other tip.

import type { Rect } from './graphics-spec';
import { corner, line, type Piece } from './stroke-path';

export interface StrokeGeometry {
  /** The outer rectangle the strokes run along (inside edge of the strokes is `thickness` px in). */
  box: Rect;
  thickness: number;
  /** Corner radius (0 = square). Already raised to the thickness when smaller. */
  radius: number;
}

function cornerSize(g: StrokeGeometry): number {
  return g.radius > 0 ? Math.max(g.radius, g.thickness) : g.thickness;
}

/**
 * The frame outline: top edge left→right, top-right corner, right edge down, bottom-right, bottom edge
 * right→left, bottom-left, left edge up, and the top-left corner last (it closes the loop).
 */
export function framePath(g: StrokeGeometry): Piece[] {
  const { x, y, w, h } = g.box;
  const [t, c] = [g.thickness, cornerSize(g)];
  const round = g.radius > 0;

  return [
    line({ x: x + c, y, w: w - 2 * c, h: t }, '+x'),
    corner('tr', { x: x + w - c, y }, c, t, round),
    line({ x: x + w - t, y: y + c, w: t, h: h - 2 * c }, '+y'),
    corner('br', { x: x + w - c, y: y + h - c }, c, t, round),
    line({ x: x + c, y: y + h - t, w: w - 2 * c, h: t }, '-x'),
    corner('bl', { x, y: y + h - c }, c, t, round),
    line({ x, y: y + c, w: t, h: h - 2 * c }, '-y'),
    corner('tl', { x, y }, c, t, round),
  ];
}

/** The four brackets (tl, tr, br, bl), arms of `length` px measured from the outer corner. */
export function cornerPaths(g: StrokeGeometry, length: number): Piece[][] {
  const { x, y, w, h } = g.box;
  const [t, c] = [g.thickness, cornerSize(g)];
  const arm = Math.max(0, Math.min(length, w / 2, h / 2) - c);
  const round = g.radius > 0;
  const [right, bottom] = [x + w, y + h];

  return [
    [
      line({ x: x + c, y, w: arm, h: t }, '-x'),
      corner('tl', { x, y }, c, t, round),
      line({ x, y: y + c, w: t, h: arm }, '+y'),
    ],
    [
      line({ x: right - c - arm, y, w: arm, h: t }, '+x'),
      corner('tr', { x: right - c, y }, c, t, round),
      line({ x: right - t, y: y + c, w: t, h: arm }, '+y'),
    ],
    [
      line({ x: right - t, y: bottom - c - arm, w: t, h: arm }, '+y'),
      corner('br', { x: right - c, y: bottom - c }, c, t, round),
      line({ x: right - c - arm, y: bottom - t, w: arm, h: t }, '-x'),
    ],
    [
      line({ x: x + c, y: bottom - t, w: arm, h: t }, '-x'),
      corner('bl', { x, y: bottom - c }, c, t, round),
      line({ x, y: bottom - c - arm, w: t, h: arm }, '-y'),
    ],
  ];
}

/** The rectangle grown by `px` on every side (negative shrinks it), on even pixels (4:2:0 chroma). */
export function inflate(box: Rect, px: number): Rect {
  const d = 2 * Math.round(px / 2);

  return { x: box.x - d, y: box.y - d, w: box.w + 2 * d, h: box.h + 2 * d };
}
