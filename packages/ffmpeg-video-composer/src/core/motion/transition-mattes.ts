// The compile-time images a designed boundary reads (radial-matte.ts), and the geometry its graph needs:
//
// - a shaped iris (`shape` other than circle): its reveal field at half the frame size,
//   centred on `origin`; `scale` is the field's top (the scale that covers the frame, in mask px).
// - a zoom-through `through` a window: the window filled white on black at full frame size; `centre` is the
//   window's centre and `scale` the zoom at which it covers the frame.
//
// A text window is a glyph's counter (the hole of an "O", the bowl of a "P"), laid out exactly as a kinetic
// block with the same text, font, size, x and y draws it (core/kinetic), so the window sits on the letter
// the outgoing scene shows. Glyph outlines come from the font file (core/glyph-outline.ts).

import type { KineticBlock } from '../../schemas/kinetic.schemas';
import { layoutWithin } from '../kinetic/fit';
import { blockTop, resolveKinetic } from '../kinetic/resolve';
import { codePoints } from '../kinetic/layout';
import type { GlyphFont, OutlinePoint } from '../glyph-outline';
import {
  centroid,
  coverScale,
  coverage,
  greyPng,
  reachTable,
  revealField,
  shapeOutline,
  signedArea,
  SHAPE_FIELD_DIVISOR,
  type MatteShape,
  type Outline,
  type Point,
} from './radial-matte';
import { MAX_THROUGH_SCALE } from './transition-through';

/** Baseline below the line top, as a fraction of the font size (kinetic-piece.ts BASELINE). */
const BASELINE = 0.8;

export type ThroughWindow =
  | {
      text: string;
      font?: string;
      size?: number;
      x?: number;
      y?: number | 'top' | 'center' | 'bottom';
      /** Which character's counter (0-based, default the first with one). */
      glyph?: number;
    }
  | { shape: MatteShape; size: number; x?: number; y?: number };

export interface MatteRequest {
  type: string;
  shape?: MatteShape;
  origin?: { x: number; y: number };
  through?: ThroughWindow;
}

export interface MatteFrame {
  width: number;
  height: number;
}

export interface BoundaryMatte {
  /** Deterministic file name, unique per geometry. */
  name: string;
  png: () => Uint8Array;
  centre: Point;
  scale: number;
}

/** Why a boundary's window cannot be drawn (the boundary then falls back), or null. */
export type MatteResult = { matte: BoundaryMatte } | { matte: null; reason: string | null };

function even(value: number): number {
  return 2 * Math.round(value / 2);
}

function hashKey(text: string): string {
  let hash = 0x811c9dc5;

  for (let i = 0; i < text.length; i++) {
    hash ^= text.codePointAt(i) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
}

function irisMatte(request: MatteRequest, frame: MatteFrame): MatteResult {
  const shape = request.shape as MatteShape;
  const [mw, mh] = [even(frame.width / SHAPE_FIELD_DIVISOR), even(frame.height / SHAPE_FIELD_DIVISOR)];
  const origin = request.origin ?? { x: 0.5, y: 0.5 };
  const outline = shapeOutline(shape, { x: origin.x * mw, y: origin.y * mh }, 1);
  const scale = coverScale(outline, mw, mh);
  const name = `iris-${shape}-${hashKey(`${mw}x${mh}:${origin.x},${origin.y}`)}.png`;

  return { matte: { name, png: () => greyPng(revealField(outline, mw, mh, scale)), centre: outline.centre, scale } };
}

/**
 * A counter's matte reaches this far (px) into the letter around it, so its anti-aliased edge blends the
 * next scene with the ink, never with the hole's own background (a bright fringe once the zoom is large).
 */
const COUNTER_BLEED = 1;

/** The outline grown by `by` px along every ray from its centre. */
function grown(outline: Outline, by: number): Outline {
  const { centre } = outline;

  return {
    centre,
    polygon: outline.polygon.map((p) => {
      const r = Math.hypot(p.x - centre.x, p.y - centre.y);
      const k = r > 0 ? (r + by) / r : 1;

      return { x: centre.x + (p.x - centre.x) * k, y: centre.y + (p.y - centre.y) * k };
    }),
  };
}

/** The deepest hole of a glyph: contours nested inside an odd number of others, the largest one. */
export function counterOf(contours: Point[][]): Point[] | null {
  const holes = contours.filter((contour, i) => {
    const probe = contour[0];
    const depth = contours.filter((other, j) => j !== i && containsPoint(other, probe)).length;

    return depth % 2 === 1;
  });

  return holes.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)))[0] ?? null;
}

function containsPoint(polygon: Point[], p: Point): boolean {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [a, b] = [polygon[i], polygon[j]];

    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }

  return inside;
}

/** Where each character of a one-line kinetic block starts (pen x) and its baseline, output px. */
function glyphPlacement(text: TextWindow, frame: MatteFrame) {
  const { font, size, x, y } = text;
  const block = { text: { en: text.text }, preset: 'fade', unit: 'glyph', font, size, x, y } as KineticBlock;
  const kframe = { ...frame, fps: 30, duration: 1, seed: 0, energy: 1 };
  const settings = resolveKinetic(block, kframe, text.text);
  const laid = layoutWithin({ ...settings, unit: 'glyph' }, text.text);

  if (laid?.unit !== 'glyph' || laid.anchored) return null;

  const top = blockTop(block.y, laid.layout.height, kframe);

  return { settings, pieces: laid.layout.pieces.map((piece) => ({ ...piece, y: piece.y + top })) };
}

function glyphContoursAt(font: GlyphFont, char: string, size: number, pen: Point): Point[][] | null {
  const contours = font.contours(char.codePointAt(0) ?? 0);
  const k = size / font.unitsPerEm;

  return (
    contours?.map((contour) => contour.map((p: OutlinePoint) => ({ x: pen.x + p.x * k, y: pen.y - p.y * k }))) ?? null
  );
}

type TextWindow = Extract<ThroughWindow, { text: string }>;

/** The counter of the character at `index`, as an outline grown into the letter, or null. */
function counterAt(
  placed: NonNullable<ReturnType<typeof glyphPlacement>>,
  font: GlyphFont,
  index: number
): Outline | null {
  const piece = placed.pieces.at(index);

  if (!piece) return null;

  const size = placed.settings.size;
  const contours = glyphContoursAt(font, piece.text, size, { x: piece.x, y: piece.y + size * BASELINE });
  const counter = contours && counterOf(contours);

  return counter ? grown({ centre: centroid(counter), polygon: counter }, COUNTER_BLEED) : null;
}

function textWindow(text: TextWindow, frame: MatteFrame, font: GlyphFont | null): Outline | string {
  if (!font) return 'its font could not be read';

  const placed = glyphPlacement(text, frame);

  if (!placed) return 'its text cannot be laid out per glyph with a bundled font';

  if (text.glyph !== undefined) return counterAt(placed, font, text.glyph) ?? `character ${text.glyph} has no counter`;

  const chars = codePoints(text.text).filter((char) => char.trim());

  for (const index of chars.keys()) {
    const counter = counterAt(placed, font, index);

    if (counter) return counter;
  }

  return 'no character has a counter';
}

function windowOutline(through: ThroughWindow, frame: MatteFrame, font: GlyphFont | null): Outline | string {
  if ('shape' in through) {
    const centre = { x: through.x ?? frame.width / 2, y: through.y ?? frame.height / 2 };

    return shapeOutline(through.shape, centre, through.size / 2);
  }

  return textWindow(through, frame, font);
}

function throughMatte(through: ThroughWindow, frame: MatteFrame, font: GlyphFont | null): MatteResult {
  const outline = windowOutline(through, frame, font);

  if (typeof outline === 'string') return { matte: null, reason: outline };

  const reach = reachTable(outline);
  const nearest = Math.min(...Array.from({ length: 64 }, (_, i) => reach((2 * Math.PI * i) / 64)));
  // The zoomed matte's edge softens with the zoom: overshoot the cover by its width at the end.
  const scale = coverScale(outline, frame.width, frame.height) * (1 + 3 / Math.max(1, nearest));

  if (scale > MAX_THROUGH_SCALE) {
    return { matte: null, reason: `its window is too small to fly through (×${Math.round(scale)})` };
  }

  const key = `${frame.width}x${frame.height}:${outline.polygon.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(';')}`;

  return {
    matte: {
      name: `through-${hashKey(key)}.png`,
      png: () => greyPng(coverage([outline.polygon], frame.width, frame.height)),
      centre: outline.centre,
      scale,
    },
  };
}

/** Whether the boundary reads a matte, and which font (bundled id or .ttf) its window needs, if any. */
export function matteFont(request: MatteRequest): string | null | undefined {
  if (request.type !== 'zoom-through' || !request.through || !('text' in request.through)) return undefined;

  return request.through.font ?? null;
}

/** The boundary's matte, or null (no matte needed, or `reason` why it cannot be drawn). */
export function boundaryMatte(request: MatteRequest, frame: MatteFrame, font: GlyphFont | null = null): MatteResult {
  if (request.type === 'iris' && request.shape && request.shape !== 'circle') return irisMatte(request, frame);

  if (request.type === 'zoom-through' && request.through) return throughMatte(request.through, frame, font);

  return { matte: null, reason: null };
}
