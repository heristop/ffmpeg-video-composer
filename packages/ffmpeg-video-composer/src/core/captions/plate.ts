// The plate behind a caption line (a DNA with a `box`): padded around the line's text box, its corner
// radius bounded by half its height and width. Shared by the drawbox renderer, which draws it as
// filled rectangles, and the HTML renderer, which draws it as a CSS border-radius box. Pure.

import type { CaptionDna } from './dna';
import type { PlacedLine } from './place';

/** Vertical plate padding relative to the horizontal one. */
export const PLATE_VERTICAL = 0.55;

export interface PlateBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  radius: number;
}

/** The plate of one line, in whole output pixels. */
export function plateBounds(line: PlacedLine, size: number, box: NonNullable<CaptionDna['box']>): PlateBounds {
  const padX = box.padding * size;
  const padY = padX * PLATE_VERTICAL;
  const left = Math.round(line.x - padX);
  const right = Math.round(line.x + line.width + padX);
  const top = Math.round(line.top - padY);
  const bottom = Math.round(line.top + size + padY);
  const radius = Math.floor(Math.min(box.radius * size, (bottom - top) / 2, (right - left) / 2));

  return { left, right, top, bottom, radius };
}
