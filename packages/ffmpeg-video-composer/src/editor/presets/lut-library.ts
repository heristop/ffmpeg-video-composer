// ---------------------------------------------------------------------------
// LUT library — programmatic .cube cinema LUTs for lut3d looks
// ---------------------------------------------------------------------------
//
// `lut3d` applies a `.cube` 3D LUT — a bigger grade jump than eq/curves — and is a standard LGPL
// filter present on every backend (host, on-device, the WASM core). Rather than bundle binary .cube
// files and stage them across three filesystems, the engine GENERATES each LUT's text at compile time
// and writes it to the build FS (uniform on Node, Expo and the browser/WASM virtual FS). A .cube file
// is plain text, so the transforms below are pure and deterministic — unit-tested to the byte.

import { quantizeStrength } from '@/core/footage/lut-cube';

type RGB = [number, number, number];
type Transform = (r: number, g: number, b: number) => RGB;

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

// Rec.709 luma — the grayscale a pixel collapses to, used for mono/noir and saturation pivots.
function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// Linear contrast around the 0.5 mid-grey pivot. k > 1 increases contrast, k < 1 flattens.
function contrast(x: number, k: number): number {
  return clamp01((x - 0.5) * k + 0.5);
}

// Push a colour away from (s > 1) or toward (s < 1) its own luma — a saturation control.
function saturate([r, g, b]: RGB, s: number): RGB {
  const l = luma(r, g, b);

  return [clamp01(l + (r - l) * s), clamp01(l + (g - l) * s), clamp01(l + (b - l) * s)];
}

// Each transform maps an input RGB (0..1) to a graded RGB (0..1). Kept simple and composable so the
// output is reproducible; the goal is distinct, usable cinema grades, not film-stock emulation.
const LUT_TRANSFORMS: Record<string, Transform> = {
  // Teal shadows, warm highlights — the classic blockbuster split-tone.
  'teal-orange': (r, g, b) => {
    const tone = luma(r, g, b) - 0.5;
    const split: RGB = [clamp01(r + tone * 0.12 + 0.02), clamp01(g + tone * 0.02), clamp01(b - tone * 0.12)];

    return saturate(split, 1.12).map((c) => contrast(c, 1.06)) as RGB;
  },
  // Gentle warm filmic lift — boosts red, trims blue, soft contrast.
  'warm-film': (r, g, b) => {
    const warm: RGB = [
      clamp01(contrast(r, 1.05) + 0.03),
      clamp01(contrast(g, 1.03) + 0.01),
      clamp01(contrast(b, 1.0) - 0.03),
    ];

    return saturate(warm, 1.05);
  },
  // Neutral black-and-white with a touch of contrast.
  mono: (r, g, b) => {
    const v = contrast(luma(r, g, b), 1.05);

    return [v, v, v];
  },
  // High-contrast monochrome noir.
  noir: (r, g, b) => {
    const v = contrast(luma(r, g, b), 1.35);

    return [v, v, v];
  },
  // Punchy, saturated, contrasty pop.
  vivid: (r, g, b) => saturate([r, g, b], 1.35).map((c) => contrast(c, 1.08)) as RGB,
};

export const LUT_NAMES = Object.keys(LUT_TRANSFORMS);

const DEFAULT_SIZE = 17;

function fmt(x: number): string {
  return clamp01(x).toFixed(6);
}

/**
 * Generates the `.cube` text for a named LUT at the given grid size (default 17³). The grid is walked
 * with red varying fastest (blue outermost), the order the `.cube` spec and `lut3d` expect. Returns
 * null for an unknown name so callers can skip staging gracefully. `strength` (0..1, default 1) blends
 * each graded point toward the identity grid in JS — a weaker version of the same grade, still ONE lut3d
 * (no blend filter). Strength 1 takes the historical path untouched, so its bytes never change.
 */
export function cubeFor(name: string, size: number = DEFAULT_SIZE, strength = 1): string | null {
  if (!Object.hasOwn(LUT_TRANSFORMS, name)) {
    return null;
  }

  const transform = LUT_TRANSFORMS[name];
  const amount = quantizeStrength(strength);
  const graded: Transform = amount === 1 ? transform : (r, g, b) => blendPoint([r, g, b], transform(r, g, b), amount);

  const header = amount === 1 ? name : `${name} @ ${amount}`;
  const lines = [`# LeClap generated LUT: ${header}`, `LUT_3D_SIZE ${size}`];
  const last = size - 1;

  for (let bi = 0; bi < size; bi++) {
    for (let gi = 0; gi < size; gi++) {
      for (let ri = 0; ri < size; ri++) {
        const [r, g, b] = graded(ri / last, gi / last, bi / last);
        lines.push(`${fmt(r)} ${fmt(g)} ${fmt(b)}`);
      }
    }
  }

  return `${lines.join('\n')}\n`;
}

// identity + (graded − identity) · amount, per channel.
function blendPoint(identity: RGB, graded: RGB, amount: number): RGB {
  return graded.map((value, channel) => identity[channel] + (value - identity[channel]) * amount) as RGB;
}
