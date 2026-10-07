// OKLab / OKLCH colour math for the reference-style analyzer. Pure and platform-neutral: the same
// numbers come out of Node, the browser and Hermes, so a palette extracted on one is the palette
// extracted on all of them.

import { rgbToHex, type Rgb } from '../color-contrast';

export interface Lab {
  l: number;
  a: number;
  b: number;
}

function toLinear(channel255: number): number {
  const c = channel255 / 255;

  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function toGamma(linear: number): number {
  const c = Math.min(1, Math.max(0, linear));

  return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
}

/** sRGB (0..255 per channel) to OKLab. */
export function rgbToOklab(r: number, g: number, b: number): Lab {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** OKLab back to sRGB, clamped into gamut (channels unrounded, 0..255). */
export function oklabToRgb(lab: Lab): Rgb {
  const l = (lab.l + 0.3963377774 * lab.a + 0.2158037573 * lab.b) ** 3;
  const m = (lab.l - 0.1055613458 * lab.a - 0.0638541728 * lab.b) ** 3;
  const s = (lab.l - 0.0894841775 * lab.a - 1.291485548 * lab.b) ** 3;

  return {
    r: toGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

/** The `#rrggbb` an OKLab colour lands on after gamut clamping. */
export function labToHex(lab: Lab): string {
  return rgbToHex(oklabToRgb(lab));
}

/** The 8-bit sRGB a `#rrggbb` hex names, re-read so contrast math sees the exact colour emitted. */
export function hexToRgb(hex: string): Rgb {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

export function chroma(lab: Lab): number {
  return Math.hypot(lab.a, lab.b);
}

/** Hue angle in degrees, 0..360. */
export function hue(lab: Lab): number {
  const degrees = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;

  return degrees < 0 ? degrees + 360 : degrees;
}

/** Shortest angular distance between two hues, 0..180. */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;

  return d > 180 ? 360 - d : d;
}

/** Euclidean distance in OKLab (a perceptual ΔE; ~0.02 is a just-noticeable difference). */
export function deltaE(x: Lab, y: Lab): number {
  return Math.hypot(x.l - y.l, x.a - y.a, x.b - y.b);
}
