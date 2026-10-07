// Turns a drawtext's position, timeline gate and alpha into what an `overlay` of its emoji images
// needs. A static position folds to integer pixels (measured text size substituted for text_w /
// text_h); a moving one (reveals, kinetic tracks — anything reading `t`) is rewritten into overlay's
// own expression language, so the image rides the exact curve the text does. The alpha curve is
// sampled on the frame grid and lowered to `fade` in/out on the image leg — core LGPL filters only.
import { evaluateExpr } from '../../services/geometry/drawtext-expr';

/** The drawtext variables a position may read, as measured for the rewritten text. */
export interface DrawtextMetrics {
  w: number;
  h: number;
  text_w: number;
  text_h: number;
  line_h: number;
  max_glyph_a: number;
  max_glyph_d: number;
  max_glyph_h: number;
  max_glyph_w: number;
}

export interface OverlayCoordinate {
  value: string;
  moving: boolean;
}

// drawtext name → overlay expression. Frame size reads as main_w/main_h (`W`/`H` in overlay, where
// lowercase w/h are the IMAGE size); time and frame number pass through.
const FRAME_NAMES: Record<string, string> = {
  w: 'W',
  W: 'W',
  main_w: 'W',
  iw: 'W',
  in_w: 'W',
  h: 'H',
  H: 'H',
  main_h: 'H',
  ih: 'H',
  in_h: 'H',
  t: 't',
  n: 'n',
  PI: 'PI',
  E: 'E',
};

const METRIC_ALIASES: Record<string, keyof DrawtextMetrics> = {
  tw: 'text_w',
  th: 'text_h',
  lh: 'line_h',
  ascent: 'max_glyph_a',
  descent: 'max_glyph_d',
};

function fmt(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function unquoted(expr: string): string {
  return expr.trim().replace(/^'(.*)'$/s, '$1');
}

function metricFor(name: string, metrics: DrawtextMetrics): number | undefined {
  const key = Object.hasOwn(METRIC_ALIASES, name) ? METRIC_ALIASES[name] : name;

  return Object.hasOwn(metrics, key) ? metrics[key as keyof DrawtextMetrics] : undefined;
}

// One identifier of the drawtext expression in overlay terms, or null when overlay can't know it.
function rewriteName(name: string, isCall: boolean, metrics: DrawtextMetrics): string | null {
  if (isCall) return name;

  if (Object.hasOwn(FRAME_NAMES, name)) return FRAME_NAMES[name];

  const metric = metricFor(name, metrics);

  return metric === undefined ? null : `(${fmt(metric)})`;
}

/** A drawtext expression rewritten for overlay, or null when it reads a name overlay has no value for. */
export function toOverlayExpr(expr: string, metrics: DrawtextMetrics): string | null {
  const unknown: string[] = [];
  const source = unquoted(expr);
  const rewritten = source.replace(/[A-Za-z_]\w*/g, (name: string, offset: number) => {
    const isCall = /^\s*\(/.test(source.slice(offset + name.length));
    const value = rewriteName(name, isCall, metrics);

    if (value === null) unknown.push(name);

    return value ?? name;
  });

  return unknown.length > 0 ? null : rewritten;
}

function metricVars(metrics: DrawtextMetrics): Record<string, number> {
  return { ...metrics };
}

/**
 * Where an emoji lands on one axis: the drawtext coordinate plus the image's offset inside the text.
 * Static coordinates fold to pixels; time-dependent ones become an overlay expression.
 */
export function overlayCoordinate(expr: unknown, offset: number, metrics: DrawtextMetrics): OverlayCoordinate | null {
  const authored = expr ?? 0;
  const fixed = evaluateExpr(authored, metricVars(metrics));

  if (fixed !== null) return { value: String(Math.round(fixed + offset)), moving: false };

  if (typeof authored !== 'string') return null;

  const moving = toOverlayExpr(authored, metrics);

  return moving === null ? null : { value: `(${moving})+${fmt(offset)}`, moving: true };
}

/** The drawtext `enable` gate as an overlay option suffix (`:enable='…'`), or '' when always on. */
export function overlayEnable(enable: unknown): string {
  if (typeof enable === 'number') return `:enable='${enable}'`;

  if (typeof enable !== 'string' || enable.trim() === '') return '';

  return `:enable='${unquoted(enable)}'`;
}

export interface FadeWindow {
  duration: number;
  fps: number;
  frame: { w: number; h: number };
}

const OPAQUE = 0.99;
const CLEAR = 0.01;

function alphaSamples(alpha: unknown, window: FadeWindow): number[] | null {
  const frames = Math.max(1, Math.round(window.duration * window.fps));
  const samples: number[] = [];

  for (let frame = 0; frame <= frames; frame++) {
    const value = evaluateExpr(alpha, { ...window.frame, t: frame / window.fps });

    if (value === null) return null;

    samples.push(Math.min(Math.max(value, 0), 1));
  }

  return samples;
}

function fadeIn(samples: number[], fps: number): string | null {
  const firstVisible = samples.findIndex((value) => value > CLEAR);
  const opaque = samples.findIndex((value, index) => index >= firstVisible && value >= OPAQUE);

  if (firstVisible === -1 || opaque <= 0) return null;

  const start = Math.max(0, firstVisible - 1) / fps;

  return `fade=t=in:st=${fmt(start)}:d=${fmt(Math.max(opaque / fps - start, 1 / fps))}:alpha=1`;
}

function fadeOut(samples: number[], fps: number): string | null {
  const lastOpaque = samples.findLastIndex((value) => value >= OPAQUE);
  const lastVisible = samples.findLastIndex((value) => value > CLEAR);

  if (lastOpaque === -1 || lastVisible >= samples.length - 1) return null;

  const start = lastOpaque / fps;

  return `fade=t=out:st=${fmt(start)}:d=${fmt(Math.max((lastVisible + 1) / fps - start, 1 / fps))}:alpha=1`;
}

/**
 * Leg filters approximating the text's alpha on its emoji image: a constant alpha becomes a
 * colour-channel mix, an entrance ramp a `fade` in, an exit ramp a `fade` out. [] when the text is
 * opaque throughout or its alpha can't be evaluated render-free.
 */
export function emojiAlphaFilters(alpha: unknown, window: FadeWindow): string[] {
  if (alpha === undefined) return [];

  const samples = alphaSamples(alpha, window);

  if (samples === null || samples.every((value) => value >= OPAQUE)) return [];

  const peak = Math.max(...samples);

  if (samples.every((value) => Math.abs(value - peak) < CLEAR)) return [`colorchannelmixer=aa=${fmt(peak)}`];

  return [fadeIn(samples, window.fps), fadeOut(samples, window.fps)].filter((value): value is string => value !== null);
}
