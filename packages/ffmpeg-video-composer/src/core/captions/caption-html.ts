// One look of a caption (a cue in a karaoke / pop / entrance state, see caption-frames.ts) as the HTML
// an HTML layer rasterises: every word absolutely placed where the plan put it, on the same shared
// baseline drawtext uses, each line's plate a CSS rounded box. The DNA's legibility effect becomes a
// stroke painted under the fill (`-webkit-text-stroke`, Satori's paint-order) and a blurred text shadow.
// Everything is laid out in a band (the caption area all cues fit in) so every raster has one size and
// composites at one position. Numbers are rounded to fixed decimals: the same state always writes the
// same markup, so the same raster. Pure.

import { findFontByFile } from '../fonts';
import { escapeHtml } from '../html/html-entities';
import type { CaptionDnaEffect } from './dna';
import { ENTRANCE_LEVELS, POP_LEVELS, type CaptionSlide, type CaptionState } from './caption-frames';
import type { CaptionFrame, SubtitleStyle } from './style';
import type { PlacedCue, PlacedLine, PlacedWord, SubtitlePlan } from './plan';
import { plateBounds } from './plate';
import { measureText } from './wrap';

/**
 * A face's vertical metrics as fractions of its size (the hhea ascender and descender, both positive) and
 * the weight drawtext draws it at (a variable face's default instance), which the layout was measured with.
 */
export interface CaptionMetrics {
  ascent: number;
  descent: number;
  weight: number;
}

/** The raster's box in output pixels. */
export interface CaptionBand {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaptionPalette {
  base: string;
  active: string;
  crown: string;
  plate: string | undefined;
}

export interface CaptionLook {
  /** The bundled font file (measured) and the CSS family it is registered under. */
  font: string;
  family: string;
  palette: CaptionPalette;
  effect: CaptionDnaEffect | undefined;
  box: SubtitleStyle['dna']['box'];
  activeScale: number;
  entrance: { type: SubtitleStyle['dna']['entrance']['type']; distance: number };
}

/** Everything the asset stage needs to rasterise a section's captions and time them (subtitles-html.ts). */
export interface CaptionTrack {
  plan: Pick<SubtitlePlan, 'cues' | 'style'>;
  look: CaptionLook;
  band: CaptionBand;
  fps: number;
  slides: CaptionSlide[];
}

/** A shadow with no offset is a glow; one with an offset a soft drop shadow (blur as a share of the size). */
const GLOW_BLUR = 0.17;
/** A glow's blur stops here (output px): resvg's cost grows with the blur, and a wider one adds little. */
const GLOW_MAX = 8;
const SHADOW_BLUR = 0.06;
/** Room around the drawn copy for strokes, shadows and a growing word, as a share of the largest size. */
const BAND_MARGIN = 0.45;

function px(value: number): string {
  const fixed = Number(value.toFixed(3));

  return `${Object.is(fixed, -0) ? 0 : fixed}px`;
}

const SAFE_COLOR = /^(?:#[\da-f]{3,8}|[a-z]+)$/i;
const FALLBACK_COLOR = '#ffffff';

/**
 * An FFmpeg colour (`#rrggbb`, `0xrrggbb`, with `@alpha`) as CSS; a named colour keeps its name. Colours
 * come from the template, so anything that is not a hex or a plain name (a stray quote, `;`, `url(`) is
 * replaced by white before it can reach the style attribute.
 */
export function cssColor(value: string): string {
  const at = value.indexOf('@');
  const hex = (at === -1 ? value : value.slice(0, at)).replace(/^0x/i, '#');

  if (!SAFE_COLOR.test(hex)) return FALLBACK_COLOR;

  if (at === -1 || !/^#[\da-f]{6}$/i.test(hex)) return hex;

  const alpha = Number(value.slice(at + 1));

  if (!Number.isFinite(alpha)) return hex;

  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));

  return `rgba(${channels.join(',')},${Number(alpha.toFixed(3))})`;
}

/** The look a subtitle style draws with, its colours and effect already resolved against the theme. */
export function captionLook(
  style: SubtitleStyle,
  palette: CaptionPalette,
  effect: CaptionDnaEffect | undefined
): CaptionLook {
  return {
    font: style.font,
    family: findFontByFile(style.font)?.cssFamily ?? style.font,
    palette,
    effect,
    box: style.dna.box,
    activeScale: style.activeScale,
    entrance: { type: style.dna.entrance.type, distance: style.dna.entrance.distance },
  };
}

function effectReach(look: CaptionLook, size: number): number {
  const outline = look.effect?.outline?.width ?? 0;
  const shadow = look.effect?.shadow;
  const offset = shadow ? Math.max(Math.abs(shadow.dx), Math.abs(shadow.dy)) + GLOW_MAX * 2 : 0;

  return size * BAND_MARGIN + outline * 2 + offset + look.entrance.distance;
}

interface Extent {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function lineExtent(line: PlacedLine, cue: PlacedCue, look: CaptionLook): Extent {
  const reach = effectReach(look, cue.size * look.activeScale);

  if (look.box) {
    const plate = plateBounds(line, cue.size, look.box);

    return {
      left: plate.left - reach,
      right: plate.right + reach,
      top: plate.top - reach,
      bottom: plate.bottom + reach,
    };
  }

  return {
    left: line.x - reach,
    right: line.x + line.width + reach,
    top: line.top - reach,
    bottom: line.top + cue.size + reach,
  };
}

/** The box every cue of the plan draws in, with room for its effects, in whole pixels inside the frame. */
export function captionBand(plan: Pick<SubtitlePlan, 'cues'>, frame: CaptionFrame, look: CaptionLook): CaptionBand {
  const extents = plan.cues.flatMap((cue) => cue.lines.map((line) => lineExtent(line, cue, look)));

  if (extents.length === 0) return { x: 0, y: 0, width: 1, height: 1 };

  const x = Math.max(0, Math.floor(Math.min(...extents.map((extent) => extent.left))));
  const y = Math.max(0, Math.floor(Math.min(...extents.map((extent) => extent.top))));
  const right = Math.min(frame.width, Math.ceil(Math.max(...extents.map((extent) => extent.right))));
  const bottom = Math.min(frame.height, Math.ceil(Math.max(...extents.map((extent) => extent.bottom))));

  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

function styleOf(entries: Array<[string, string | undefined]>): string {
  return entries
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}:${value}`)
    .join(';');
}

/** Copy safe in an HTML layer: escaped, and with no `{{ }}` for the placeholder pass to fill. */
function captionText(text: string): string {
  return escapeHtml(text).replaceAll('{', '&#123;').replaceAll('}', '&#125;');
}

type PaintColor = 'base' | 'active' | 'crown';

interface WordPaint {
  color: PaintColor;
  /** The font size the word is drawn at. */
  size: number;
}

// How word `index` of the cue is drawn in `state`, as the drawbox renderer draws it (subtitles.ts).
function wordPaint(plan: Pick<SubtitlePlan, 'style'>, cue: PlacedCue, state: CaptionState, index: number): WordPaint {
  const mode = plan.style.karaoke;
  const { size } = cue;

  if (cue.crowned) return { color: 'crown', size };

  if (mode === 'fill') return { color: index < state.filled ? 'active' : 'base', size };

  if (mode === false || index !== state.active) return { color: 'base', size };

  const peak = plan.style.activeScale;

  if (mode === 'pop') return { color: 'active', size: size * (1 + (peak - 1) * (state.bump / POP_LEVELS)) };

  return { color: 'active', size: peak === 1 ? size : Math.round(size * peak) };
}

export interface CaptionHtmlRequest {
  plan: Pick<SubtitlePlan, 'cues' | 'style'>;
  state: CaptionState;
  look: CaptionLook;
  band: CaptionBand;
  metrics: CaptionMetrics;
}

function textEffect(look: CaptionLook, size: number): Array<[string, string | undefined]> {
  const { outline, shadow } = look.effect ?? {};
  const glow = shadow?.dx === 0 && shadow.dy === 0;
  const glowBlur = Math.min(GLOW_MAX, size * GLOW_BLUR);
  const blur = shadow ? Math.max(1, Math.round(glow ? glowBlur : size * SHADOW_BLUR)) : 0;

  return [
    ['text-shadow', shadow && `${px(shadow.dx)} ${px(shadow.dy)} ${px(blur)} ${cssColor(shadow.color)}`],
    ['-webkit-text-stroke', outline && `${px(outline.width * 2)} ${cssColor(outline.color)}`],
  ];
}

/** Entrance progress applied to every element of the look: an opacity (while entering) and a lift. */
interface Entering {
  opacity: string | undefined;
  lift: number;
}

function plateHtml(line: PlacedLine, cue: PlacedCue, request: CaptionHtmlRequest, entering: Entering): string {
  const { look, band } = request;
  const plate = plateBounds(line, cue.size, look.box as NonNullable<CaptionLook['box']>);
  const style = styleOf([
    ['position', 'absolute'],
    ['left', px(plate.left - band.x)],
    ['top', px(plate.top - band.y + entering.lift)],
    ['width', px(plate.right - plate.left)],
    ['height', px(plate.bottom - plate.top)],
    ['border-radius', px(plate.radius)],
    ['background-color', cssColor(look.palette.plate as string)],
    ['opacity', entering.opacity],
  ]);

  return `<div style="${style}"></div>`;
}

// A word centred on its placed box (a grown word grows around its centre), its baseline on the line's.
function wordHtml(
  word: PlacedWord,
  line: PlacedLine,
  paint: WordPaint,
  request: CaptionHtmlRequest,
  entering: Entering
) {
  const { look, band, metrics } = request;
  const { size } = paint;
  const width =
    size === request.plan.cues[request.state.cue].size
      ? word.width
      : (measureText(look.font, word.text, size) ?? word.width);
  // line-height 1: the face's ascent + descent centred in a box one size tall, so the baseline sits at
  // top + size × ((1 - ascent - descent) / 2 + ascent).
  const baseline = size * ((1 - metrics.ascent - metrics.descent) / 2 + metrics.ascent);
  const style = styleOf([
    ['position', 'absolute'],
    ['left', px(word.x + word.width / 2 - width / 2 - band.x)],
    ['top', px(line.baseline - baseline - band.y + entering.lift)],
    ['font-family', `'${look.family}'`],
    ['font-size', px(size)],
    ['font-weight', String(metrics.weight)],
    ['line-height', '1'],
    ['white-space', 'nowrap'],
    ['color', cssColor(look.palette[paint.color])],
    ['opacity', entering.opacity],
    ...textEffect(look, size),
  ]);

  return `<div style="${style}">${captionText(word.text)}</div>`;
}

/** The markup of one caption look, sized to `band`. */
export function captionHtml(request: CaptionHtmlRequest): string {
  const { plan, state, look, band } = request;
  const cue = plan.cues[state.cue];
  const progress = state.reveal / ENTRANCE_LEVELS;
  const entering: Entering = {
    opacity: progress < 1 ? String(Number(Math.max(0, progress).toFixed(3))) : undefined,
    lift: look.entrance.type === 'rise' ? look.entrance.distance * (1 - progress) : 0,
  };
  const plates = look.box && look.palette.plate ? cue.lines.map((line) => plateHtml(line, cue, request, entering)) : [];
  const placed = cue.lines.flatMap((line) => line.words.map((word) => ({ word, line })));
  const words = placed.map(({ word, line }, index) =>
    wordHtml(word, line, wordPaint(plan, cue, state, index), request, entering)
  );
  const root = `display:flex;position:relative;width:${px(band.width)};height:${px(band.height)}`;

  return `<div style="${root}">${[...plates, ...words].join('')}</div>`;
}
