// ---------------------------------------------------------------------------
// Compile-time fx sprites: tiny deterministic images rendered at their exact on-screen size
// ---------------------------------------------------------------------------
//
// Procedural effects that need a shape FFmpeg cannot draw (a gaussian disc, an anti-aliased ring, a star,
// a rounded mask) describe it as a `sprite:` URL. The asset stage (AssetManager.fetchMedia) renders it with
// spritePng and writes it to the build FS like a `panel:`, so it works the same on Node, Expo/Hermes and
// browser/WASM: plain Uint8Array math, no Buffer, no zlib, no canvas. Same spec, same bytes.
//
// Colour convention: RGB is the sprite colour on EVERY pixel and alpha carries the shape (premultiplied
// edge colour), so scaling or blending a sprite never pulls a dark fringe in from transparent black.

import { fnv1a32 } from '@/core/determinism/hash';
import { encodePng, type PngImage } from './png-encode';
import { BAND_PROFILES, spriteCoverage, type SpriteKind, type SpriteSpec } from './fx-sprite-shapes';

export {
  BAND_PROFILES,
  bandProfile,
  roundedRectDistance,
  type BandProfile,
  type SpriteKind,
  type SpriteSpec,
} from './fx-sprite-shapes';

const SCHEME = 'sprite:';
const KINDS: readonly SpriteKind[] = [
  'disc',
  'ring',
  'star',
  'stroke',
  'mask',
  'piece',
  'band',
  'bokeh',
  'rim',
  'feather',
  'glow',
];
const NUMERIC = [
  'w',
  'h',
  'sigma',
  'radius',
  'stroke',
  'halo',
  'flare',
  'width',
  'tilt',
  'bloom',
  'peak',
  'inset',
] as const;
const WORDS = ['shape', 'profile'] as const;
const ALLOWED: Record<(typeof WORDS)[number], readonly string[]> = {
  shape: ['rect', 'disc'],
  profile: BAND_PROFILES,
};
// A sprite is at most a frame; this ceiling rejects a runaway size before the per-pixel allocation.
const MAX_DIMENSION = 4096;
const DEFAULT_COLOR = 'ffffff';

function hexByte(hex: string, at: number): number {
  return parseInt(hex.slice(at, at + 2), 16);
}

function colorOf(spec: SpriteSpec): [number, number, number] {
  const hex = /^[0-9a-f]{6}$/i.test(spec.color ?? '') ? (spec.color as string) : DEFAULT_COLOR;

  return [hexByte(hex, 0), hexByte(hex, 2), hexByte(hex, 4)];
}

function clampSide(value: number): number {
  return Math.min(MAX_DIMENSION, Math.max(1, Math.round(value)));
}

function writePixel(data: Uint8Array, i: number, value: number, rgb: [number, number, number] | null): void {
  if (rgb) {
    data.set([...rgb, value], i);

    return;
  }

  data[i] = value;
}

/** The sprite's pixels: grayscale for a `mask`/`feather` (alphamerge inputs), straight-alpha RGBA otherwise. */
export function spriteImage(spec: SpriteSpec): PngImage {
  const [width, height] = [clampSide(spec.w), clampSide(spec.h)];
  const coverage = spriteCoverage({ ...spec, w: width, h: height });
  const channels = spec.kind === 'mask' || spec.kind === 'feather' ? 1 : 4;
  const data = new Uint8Array(width * height * channels);
  const rgb = channels === 4 ? colorOf(spec) : null;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = Math.round(255 * Math.min(1, Math.max(0, coverage(x + 0.5 - width / 2, y + 0.5 - height / 2))));

      writePixel(data, (y * width + x) * channels, value, rgb);
    }
  }

  return { width, height, channels, data };
}

/** The sprite as PNG bytes. */
export function spritePng(spec: SpriteSpec): Uint8Array {
  return encodePng(spriteImage(spec));
}

/** The canonical `sprite:` URL of a spec: fixed key order and rounded numbers, so equal specs share a file. */
export function spriteUrl(spec: SpriteSpec): string {
  const numbers = NUMERIC.flatMap((key) => {
    const value = spec[key];

    return value === undefined ? [] : [`${key}=${Number(value.toFixed(3))}`];
  });
  const color = spec.color ? [`c=${spec.color.replace('#', '').toLowerCase()}`] : [];
  const words = WORDS.flatMap((key) => (spec[key] ? [`${key}=${spec[key]}`] : []));

  return `${SCHEME}${[`kind=${spec.kind}`, ...numbers, ...color, ...words].join(',')}`;
}

function pairsOf(body: string): Map<string, string> {
  return new Map(
    body.split(',').flatMap((part) => {
      const eq = part.indexOf('=');

      return eq === -1 ? [] : [[part.slice(0, eq).trim(), part.slice(eq + 1).trim()] as [string, string]];
    })
  );
}

function numbersOf(pairs: Map<string, string>): Partial<Record<(typeof NUMERIC)[number], number>> | null {
  const out: Partial<Record<(typeof NUMERIC)[number], number>> = {};

  for (const key of NUMERIC) {
    const raw = pairs.get(key);
    const value = Number(raw);

    if (raw !== undefined && (!Number.isFinite(value) || Math.abs(value) > MAX_DIMENSION * 4)) return null;

    if (raw !== undefined) out[key] = value;
  }

  return out;
}

// The enumerated fields (shape, profile): absent, or one of their allowed words.
function wordsOf(pairs: Map<string, string>): Partial<SpriteSpec> | null {
  const out: Partial<Record<(typeof WORDS)[number], string>> = {};

  for (const key of WORDS) {
    const value = pairs.get(key);

    if (value !== undefined && !ALLOWED[key].includes(value)) return null;

    if (value !== undefined) out[key] = value;
  }

  return out as Partial<SpriteSpec>;
}

function inSize(value: number | undefined): value is number {
  return value !== undefined && value >= 1 && value <= MAX_DIMENSION;
}

/** Parses a `sprite:` URL back to its spec; null for any other string or an invalid/oversized spec. */
export function parseSpriteUrl(url: string): SpriteSpec | null {
  if (!url.startsWith(SCHEME)) return null;

  const pairs = pairsOf(url.slice(SCHEME.length));
  const kind = pairs.get('kind') as SpriteKind | undefined;
  const numbers = numbersOf(pairs);
  const words = wordsOf(pairs);
  const color = pairs.get('c');
  const colorOk = color === undefined || /^[0-9a-f]{6}$/.test(color);

  if (!kind || !KINDS.includes(kind) || !numbers || !words || !colorOk) return null;

  const { w, h } = numbers;

  if (!inSize(w) || !inSize(h)) return null;

  return { kind, ...numbers, w, h, ...(color ? { color } : {}), ...words };
}

/** A deterministic file name for a spec, e.g. `sprite-band-1a2b3c4d.png`. */
export function spriteFileName(spec: SpriteSpec): string {
  return `sprite-${spec.kind}-${fnv1a32(spriteUrl(spec)).toString(16).padStart(8, '0')}.png`;
}
