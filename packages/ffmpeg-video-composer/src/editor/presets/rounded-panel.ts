// ---------------------------------------------------------------------------
// Rounded-panel PNG generator — caption-panel overlays without a runtime image lib
// ---------------------------------------------------------------------------
//
// Text-sugar captions want a soft rounded backdrop behind them. Rather than ship a binary PNG per
// size/colour and stage it across three filesystems, the engine GENERATES the panel image at compile
// time and writes it to the build FS (uniform on Node, Expo and the browser/WASM virtual FS). Like the
// LUT library it mirrors, the output is a pure, deterministic function of a small spec — unit-tested to
// the byte. The catch: the engine also runs on React-Native/Hermes, which has no `Buffer` and no
// `zlib`, so the PNG is hand-encoded with plain `Uint8Array` math and DEFLATE *stored* (uncompressed)
// blocks — no npm deps, no Node built-ins (editor/presets/png-encode.ts, shared with the fx sprites).

import { encodePng } from './png-encode';

export { encodePng, type PngImage } from './png-encode';

/** A rounded caption panel: a `width`×`height` box, `radius`-corner, filled with `color` at `opacity`. */
export interface PanelSpec {
  width: number;
  height: number;
  radius: number;
  /** 6-hex RGB string WITHOUT a leading `#`, e.g. `'0a0f14'`. */
  color: string;
  /** 0..1 straight alpha applied to the whole fill. */
  opacity: number;
}

const DEFAULT_RADIUS = 24;
const DEFAULT_COLOR = '0a0f14';
const DEFAULT_OPACITY = 0.72;
// Upper bound on a panel edge. A caption panel is at most a video frame wide; this ceiling rejects a
// runaway `w=`/`h=` before it reaches the per-pixel allocation (a 50000² panel is ~10 GB) — matters
// most on the memory-constrained WASM/Hermes targets.
const MAX_DIMENSION = 8192;

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function inPixelRange(n: number): boolean {
  return Number.isFinite(n) && n >= 1 && n <= MAX_DIMENSION;
}

// Normalise a `c=` value to a 6-hex-digit RGB string. Accepts an optional leading `#` and 3-digit CSS
// shorthand (expanded, e.g. `fff` → `ffffff`); anything malformed or empty falls back to the default
// instead of nibble-misaligning a short string into a silently-wrong colour.
function normalizeColor(raw: string | undefined): string {
  if (raw === undefined) {
    return DEFAULT_COLOR;
  }

  const hex = (raw.startsWith('#') ? raw.slice(1) : raw).toLowerCase();

  if (/^[0-9a-f]{6}$/.test(hex)) {
    return hex;
  }

  if (/^[0-9a-f]{3}$/.test(hex)) {
    return hex.replace(/./g, (c) => c + c);
  }

  return DEFAULT_COLOR;
}

/**
 * Parses a `panel:` overlay URL — comma-separated `key=value` pairs after the scheme, order-independent,
 * e.g. `panel:w=380,h=150,r=28,c=0a0f14,o=0.72`. Width and height are required and must be positive;
 * radius, colour and opacity fall back to defaults. Radius is clamped so the corners never overlap and
 * opacity is clamped to 0..1. Returns null for any non-`panel:` string or a missing/invalid size.
 */
export function parsePanelUrl(url: string): PanelSpec | null {
  if (!url.startsWith('panel:')) {
    return null;
  }

  const body = url.slice('panel:'.length);
  const pairs = new Map<string, string>();

  for (const part of body.split(',')) {
    const eq = part.indexOf('=');

    if (eq === -1) {
      continue;
    }
    pairs.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }

  // Floor before the range check: a sub-pixel `w=0.5` must be rejected, not silently floored to a
  // zero-dimension PNG that every decoder treats as corrupt.
  const width = Math.floor(Number(pairs.get('w')));
  const height = Math.floor(Number(pairs.get('h')));

  if (!inPixelRange(width) || !inPixelRange(height)) {
    return null;
  }

  const rawRadius = pairs.has('r') ? Number(pairs.get('r')) : DEFAULT_RADIUS;
  const radius = Number.isFinite(rawRadius) ? rawRadius : DEFAULT_RADIUS;

  const rawOpacity = pairs.has('o') ? Number(pairs.get('o')) : DEFAULT_OPACITY;
  const opacity = Number.isFinite(rawOpacity) ? clamp(rawOpacity, 0, 1) : DEFAULT_OPACITY;

  const maxRadius = Math.floor(Math.min(width, height) / 2);

  return {
    width,
    height,
    radius: clamp(Math.floor(radius), 0, maxRadius),
    color: normalizeColor(pairs.get('c')),
    opacity,
  };
}

/**
 * A deterministic cache filename for a spec, e.g. `panel-380x150-r28-0a0f14-o72.png` (opacity as an
 * integer percent). Identical specs map to one filename so the build can reuse a staged panel.
 */
export function panelFileName(spec: PanelSpec): string {
  const pct = Math.round(spec.opacity * 100);

  return `panel-${spec.width}x${spec.height}-r${spec.radius}-${spec.color}-o${pct}.png`;
}

// Parse one channel of a 6-hex colour string; a malformed digit collapses to 0 rather than NaN.
function hexByte(hex: string, at: number): number {
  const value = parseInt(hex.slice(at, at + 2), 16);

  return Number.isFinite(value) ? value : 0;
}

/**
 * Analytic coverage for a pixel centre inside a rounded rectangle. Straight edges and the interior read
 * full (1); only a corner's outer region tapers, via the signed distance to that corner's arc centre —
 * `clamp(radius - dist + 0.5)` gives a 1px anti-aliased edge.
 */
// The arc centre of whichever corner this pixel sits in; null when the pixel is on a straight run.
// Corners never overlap (radius is capped at half the shorter side), so at most one branch matches.
function cornerArcCenter(cx: number, cy: number, spec: PanelSpec): { x: number; y: number } | null {
  const { width, height, radius } = spec;

  if (cx < radius && cy < radius) {
    return { x: radius, y: radius };
  }

  if (cx > width - radius && cy < radius) {
    return { x: width - radius, y: radius };
  }

  if (cx < radius && cy > height - radius) {
    return { x: radius, y: height - radius };
  }

  if (cx > width - radius && cy > height - radius) {
    return { x: width - radius, y: height - radius };
  }

  return null;
}

function cornerCoverage(cx: number, cy: number, spec: PanelSpec): number {
  const { radius } = spec;

  if (radius <= 0) {
    return 1;
  }

  const arc = cornerArcCenter(cx, cy, spec);

  if (!arc) {
    return 1;
  }

  const dist = Math.hypot(cx - arc.x, cy - arc.y);

  return clamp(radius - dist + 0.5, 0, 1);
} // straight alpha, no premultiplication

// Re-exported: the drawbox band sampling lives in ./rounded-bands, out of the PNG encoder's module.
export { roundedBands, type RoundedBand } from './rounded-bands';

// The panel's straight-alpha RGBA pixels, row-major.
function rawImageBytes(spec: PanelSpec): Uint8Array {
  const { width, height, color, opacity } = spec;
  const r = hexByte(color, 0);
  const g = hexByte(color, 2);
  const b = hexByte(color, 4);
  const baseAlpha = Math.round(clamp(opacity, 0, 1) * 255);
  const data = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const coverage = cornerCoverage(x + 0.5, y + 0.5, spec);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = Math.round(baseAlpha * coverage);
    }
  }

  return data;
}

/**
 * Generates the RGBA PNG bytes for a rounded panel — colour type 6, 8-bit depth, straight alpha with
 * 1px anti-aliased corners. Pure and deterministic: the same spec always yields byte-identical output.
 */
export function roundedPanelPng(input: PanelSpec): Uint8Array {
  // Normalise the generator's own inputs so a directly-built PanelSpec (not routed through
  // parsePanelUrl) can't break scanline framing or the corner math: integer dimensions ≥1, and a
  // radius capped at half the shorter side so two corner regions never overlap and fight (the
  // "corners never overlap" contract the module documents but parsePanelUrl alone enforced).
  const width = Math.max(1, Math.floor(input.width));
  const height = Math.max(1, Math.floor(input.height));
  const radius = clamp(Math.floor(input.radius), 0, Math.floor(Math.min(width, height) / 2));
  const spec: PanelSpec = { ...input, width, height, radius };

  return encodePng({ width, height, channels: 4, data: rawImageBytes(spec) });
}
