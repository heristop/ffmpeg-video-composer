// Preset extras beyond per-unit tracks: the typewriter caret, scramble's decoy glyphs, highlight's marker
// sweep and the counter's rolling number. drawbox geometry is fixed per filter instance (FFmpeg does not
// re-evaluate it per frame), so moving boxes are emitted as one box per frame, each gated by an `enable`
// window: frame-exact, deterministic, and on every backend.

import type { Filter } from '../types';
import { parseEasing, type EasingSpec } from '../motion/easing';
import { easedProgressExpr, fmt } from '../motion/hermite';
import { seededRandom } from '../determinism/hash';
import { escapeDrawtextText } from '../drawtext-text';
import { codePoints, measureBundled, type LayoutPiece } from './layout';
import type { ResolvedKinetic } from './resolve';

const SWEEP_SECONDS = 0.35;
const SWEEP_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
export const DEFAULT_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*';
const DECOYS = 3;

function windowExpr(from: number, to: number | null): string {
  return to === null ? `'gte(t,${fmt(from)})'` : `'gte(t,${fmt(from)})*lt(t,${fmt(to)})'`;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  enable: string;
}

function box({ x, y, w, h, color, enable }: Box): Filter {
  return {
    type: 'drawbox',
    values: { x: fmt(x), y: fmt(y), w: fmt(Math.max(1, w)), h: fmt(h), color, t: 'fill', enable },
  };
}

/** typewriter: a caret that rides after the last typed glyph, then blinks until the block leaves. */
export function caretBoxes(
  settings: ResolvedKinetic,
  pieces: LayoutPiece[],
  starts: number[],
  end: number | null
): Filter[] {
  const w = Math.max(2, settings.size * 0.06);
  const h = settings.size * 0.8;
  const top = settings.size * 0.12;
  const filters = pieces.map((piece, i) => {
    const until = i + 1 < pieces.length ? starts[i + 1] : starts[i] + 0.25;

    return box({
      x: piece.x + piece.width + w,
      y: piece.y + top,
      w,
      h,
      color: settings.color,
      enable: windowExpr(starts[i], until),
    });
  });
  const last = pieces.at(-1);

  if (last) {
    const from = (starts.at(-1) ?? 0) + 0.25;
    const blink = `'gte(t,${fmt(from)})*lt(mod(t-${fmt(from)},1),0.5)${end === null ? '' : `*lt(t,${fmt(end)})`}'`;
    filters.push(box({ x: last.x + last.width + w, y: last.y + top, w, h, color: settings.color, enable: blink }));
  }

  return filters;
}

/** scramble: before each glyph lands, a few seeded decoy characters flicker in its slot. */
export function scrambleDecoys(
  settings: ResolvedKinetic,
  pieces: LayoutPiece[],
  starts: number[],
  charset: string | undefined,
  seed: number
): Filter[] {
  const chars = codePoints(charset ?? DEFAULT_CHARSET);
  const random = seededRandom(seed);
  const window = settings.duration;

  return pieces.flatMap((piece, i) =>
    Array.from({ length: DECOYS }, (_, k) => {
      const from = Math.max(0, starts[i] - window + (k * window) / DECOYS);
      const char = chars[Math.floor(random() * chars.length)];
      const width = measureBundled(settings.font, char, settings.size) ?? piece.width;

      return {
        type: 'drawtext',
        values: {
          text: char,
          fontfile: settings.font,
          fontsize: settings.size,
          fontcolor: `${settings.color}@0.55`,
          x: fmt(piece.x + (piece.width - width) / 2),
          // Same shared baseline as the real glyph (see editor/presets/kinetic.ts).
          y: `'${fmt(piece.y + settings.size * 0.8)}-max_glyph_a'`,
          enable: windowExpr(from, from + window / DECOYS),
        },
      } as unknown as Filter;
    })
  );
}

export interface MarkerSweep {
  piece: LayoutPiece;
  start: number;
  /** When the marker disappears, or null to hold to the cut. */
  end: number | null;
  color: string;
  fps: number;
}

/** highlight: a marker that sweeps open behind a word once it has landed, one box per frame. */
export function markerSweep(settings: ResolvedKinetic, sweep: MarkerSweep): Filter[] {
  const { piece, start, end, color, fps } = sweep;
  const pad = settings.size * 0.12;
  const full = piece.width + 2 * pad;
  const geometry = { x: piece.x - pad, y: piece.y + settings.size * 0.2, h: settings.size * 0.72, color };
  const curve = parseEasing(SWEEP_EASE).fn;
  const frames = Math.max(1, Math.ceil(SWEEP_SECONDS * fps));
  const steps = Array.from({ length: frames }, (_, f) =>
    box({ ...geometry, w: full * curve((f + 1) / frames), enable: windowExpr(start + f / fps, start + (f + 1) / fps) })
  );

  return [...steps, box({ ...geometry, w: full, enable: windowExpr(start + frames / fps, end) })];
}

/** counter: the value rolling from `from` to `to`, as a drawtext text expansion. */
export function counterText(
  counter: { from: number; to: number; decimals?: number; prefix?: string; suffix?: string },
  window: { delay: number; duration: number },
  ease: EasingSpec
): string {
  const progress = easedProgressExpr(parseEasing(ease), window);
  const value = `(${fmt(counter.from)}+${fmt(counter.to - counter.from)}*(${progress}))`;
  const decimals = counter.decimals ?? 0;
  const whole = String.raw`%{eif\:floor(${value})\:d}`;
  const fraction =
    decimals > 0 ? String.raw`.%{eif\:mod(floor(${value}*${10 ** decimals}),${10 ** decimals})\:d\:${decimals}}` : '';
  const number = `${whole}${fraction}`;

  return `${escapeDrawtextText(counter.prefix ?? '')}${number}${escapeDrawtextText(counter.suffix ?? '')}`;
}
