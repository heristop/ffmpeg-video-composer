// Contrast enforcement for derived theme roles: move a colour's OKLab lightness (and ease its chroma)
// toward white or black until it meets a WCAG ratio against the background, changing it as little as
// the ratio allows. Ratios are measured on the emitted `#rrggbb`, never on unrounded floats.

import { contrastRatio, type Rgb } from '../color-contrast';
import { hexToRgb, labToHex, type Lab } from './oklab';

export const AA_TEXT = 4.5;
export const AA_LARGE = 3;

const SEARCH_STEPS = 24;
const WHITE: Lab = { l: 1, a: 0, b: 0 };
const BLACK: Lab = { l: 0, a: 0, b: 0 };

export function ratioOf(hex: string, bg: Rgb): number {
  return contrastRatio(hexToRgb(hex), bg);
}

function toward(lab: Lab, target: Lab, t: number): Lab {
  // Chroma eases out slower than lightness moves, so a hue survives a strong lightness shift.
  const keep = 1 - 0.6 * t;

  return { l: lab.l + (target.l - lab.l) * t, a: lab.a * keep, b: lab.b * keep };
}

function search(lab: Lab, target: Lab, bg: Rgb, min: number): string | null {
  if (ratioOf(labToHex(toward(lab, target, 1)), bg) < min) return null;

  let lo = 0;
  let hi = 1;

  for (let step = 0; step < SEARCH_STEPS; step++) {
    const mid = (lo + hi) / 2;

    if (ratioOf(labToHex(toward(lab, target, mid)), bg) >= min) {
      hi = mid;
      continue;
    }
    lo = mid;
  }

  return labToHex(toward(lab, target, hi));
}

export interface Enforced {
  hex: string;
  adjusted: boolean;
}

/**
 * The colour itself when it already reaches `min` against `bg`; otherwise the nearest lightness shift
 * that does, trying the direction with more headroom first. Falls back to pure white or black.
 */
export function enforceContrast(lab: Lab, bg: Rgb, min: number): Enforced {
  const hex = labToHex(lab);

  if (ratioOf(hex, bg) >= min) return { hex, adjusted: false };

  const whiteFirst = contrastRatio({ r: 255, g: 255, b: 255 }, bg) >= contrastRatio({ r: 0, g: 0, b: 0 }, bg);
  const order = whiteFirst ? [WHITE, BLACK] : [BLACK, WHITE];
  const found = search(lab, order[0], bg, min) ?? search(lab, order[1], bg, min);

  return { hex: found ?? labToHex(order[0]), adjusted: true };
}
