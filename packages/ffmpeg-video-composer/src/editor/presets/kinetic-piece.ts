// One kinetic unit → its drawtext (editor/presets/kinetic.ts). A unit is painted in a style — its colour
// and effect (the visible copy), white without effect (a fill's mask), or an invisible face that still
// casts its effect (under a fill) — and read on a clock (`t`, or a delayed `(t-lag)` for a trail echo),
// so echoes, masks and fills all follow exactly the same per-unit expressions.

import type { Filter } from '@/core/types';
import type { KineticBlock } from '../../schemas/kinetic.schemas';
import { trackExpr, type TrackKey } from '@/core/motion/tracks';
import { fmt } from '@/core/motion/hermite';
import type { LayoutPiece } from '@/core/kinetic/layout';
import type { ResolvedKinetic } from '@/core/kinetic/resolve';
import type { UnitTracks } from '@/core/kinetic/units';
import { applyTextEffect } from './text';

/** Baseline below the line top, as a fraction of the font size. */
export const BASELINE = 0.8;

/** x-anchor suffix per alignment for a string placed by its own drawn width. */
export const ALIGN_ANCHOR = { left: '', center: '-text_w/2', right: '-text_w' } as const;

export interface PieceDraw {
  piece: LayoutPiece;
  tracks: UnitTracks;
  start: number;
  arrive: number;
  /** When the unit starts leaving and how long that takes, or null when it holds to the cut. */
  leave: { at: number; duration: number } | null;
  index: number;
  color: string;
}

/**
 * How a unit is painted. `anchored` places whole lines by drawtext's own text_w (shaped or unmeasurable
 * copy; see core/kinetic/fit.ts); `t` is the clock the unit's tracks read (default `t`).
 */
export interface PieceStyle {
  color: string;
  effect: KineticBlock['effect'];
  anchored: boolean;
  t?: string;
}

export function quoted(expr: string): string {
  return `'${expr}'`;
}

function offset(base: number, keys: TrackKey[], time: string): string {
  const expr = trackExpr(keys, 0, time);

  return expr === '0' ? fmt(base) : quoted(`${fmt(base)}+(${expr})`);
}

function waveTerm(block: KineticBlock, settings: ResolvedKinetic, draw: PieceDraw, t: string): string {
  if (settings.preset !== 'wave') return '';

  const amplitude = (block.amplitude ?? settings.size * 0.06) * (settings.distance > 0 ? 1 : 0);
  const frequency = block.frequency ?? 1.2;

  return `+${fmt(amplitude)}*sin(6.283185*(${fmt(frequency)}*${t}-${fmt(draw.index * 0.08)}))*clip((${t}-${fmt(draw.arrive)})/0.4,0,1)`;
}

function pieceX(settings: ResolvedKinetic, draw: PieceDraw, scale: string | null, style: PieceStyle): unknown {
  const { piece, tracks } = draw;
  const t = style.t ?? 't';

  if (style.anchored) {
    return quoted(`${fmt(settings.x)}+(${trackExpr(tracks.x, 0, t)})${ALIGN_ANCHOR[settings.align]}`);
  }

  // A scaled unit grows around its own centre: anchor x on the centre, y on the em box.
  if (scale) return quoted(`${fmt(piece.x + piece.width / 2)}+(${trackExpr(tracks.x, 0, t)})-text_w/2`);

  return offset(piece.x, tracks.x, t);
}

/** One unit's drawtext in `style`. */
export function pieceFilter(
  block: KineticBlock,
  settings: ResolvedKinetic,
  draw: PieceDraw,
  style: PieceStyle
): Filter {
  const { piece, tracks } = draw;
  const t = style.t ?? 't';
  const scale = tracks.scale ? trackExpr(tracks.scale, 0, t) : null;
  const size = settings.size;
  // Every piece sits on the line's shared baseline: drawtext places a string by its own glyph box, so
  // `baseline - max_glyph_a` keeps a lone comma or lowercase glyph from floating. A scaled piece keeps
  // its em box centred, so its baseline moves with the scale.
  const baseline = scale
    ? `${fmt(piece.y + size / 2)}+${fmt(size * (BASELINE - 0.5))}*(${scale})`
    : fmt(piece.y + size * BASELINE);
  const y = `${baseline}-max_glyph_a+(${trackExpr(tracks.y, 0, t)})${waveTerm(block, settings, draw, t)}`;
  const values: Record<string, unknown> = {
    text: piece.text,
    fontfile: settings.font,
    fontsize: scale ? quoted(`${fmt(settings.size)}*(${scale})`) : settings.size,
    fontcolor: style.color,
    x: pieceX(settings, draw, scale, style),
    y: quoted(y),
    alpha: quoted(`clip(${trackExpr(tracks.opacity, 0, t)},0,1)`),
  };
  applyTextEffect(values, style.effect);

  return { type: 'drawtext', values };
}
