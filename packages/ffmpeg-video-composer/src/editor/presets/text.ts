import { findFont, isFontRef, type FontInput } from '@/core/fonts';

export type Translation = Record<string, string | undefined>;

// Resolve an authored font to a drawtext fontfile, falling back to the given preset file. Shared by
// every text sugar so font handling lives in one place.
//
// A font named by family is passed through untouched: it is the FormatterManager that turns it into
// a staged filename, because that is where the staging queue lives and where the family / weight /
// style must travel together to the download.
export function resolveFontFile(font: FontInput | undefined, presetFile: string): FontInput {
  if (!font) {
    return presetFile;
  }

  if (isFontRef(font)) {
    return font;
  }

  const entry = findFont(font);

  if (entry) {
    return entry.file;
  }

  if (font.endsWith('.ttf')) {
    return font;
  }

  return presetFile;
}

// ---------------------------------------------------------------------------
// reveal — animated entrance for sugar text (caption / titleCard / lowerThird)
// ---------------------------------------------------------------------------
//
// Authors hand-wrote drawtext `alpha` and kinetic `x`/`y` `t`-expressions for every animated entrance
// (45+ across the bundled templates, one shipped with a syntax bug). `revealToExpr` GENERATES those
// expressions from a small intent — `{ type, delay, duration, distance }` — so the sugar tiers never
// hand-author timing math. Pure and string-deterministic, so the exact output is unit-tested.

export const REVEAL_TYPES = ['none', 'fade', 'rise', 'slide-left', 'slide-right'] as const;
export type RevealType = (typeof REVEAL_TYPES)[number];

export const REVEAL_EASINGS = ['linear', 'ease-out', 'ease-in-out', 'ease-out-back'] as const;
export type RevealEasing = (typeof REVEAL_EASINGS)[number];

export type Reveal = {
  type: RevealType;
  /** Seconds before the entrance starts (default 0.3). */
  delay?: number;
  /** Seconds the entrance takes (default 0.6). */
  duration?: number;
  /** Pixels the text travels for rise/slide entrances (default 60). */
  distance?: number;
  /** Progress curve for the entrance ramp (default linear). */
  easing?: RevealEasing;
};

/** A reveal authored either as the bare type ("rise") or the full object. */
export type RevealInput = RevealType | Reveal;

// drawtext expressions produced by a reveal: an `alpha` ramp and, for moving entrances, an `x`/`y`
// override. Each is already single-quoted because it contains commas, which would otherwise be read
// as filter-option separators.
export type RevealExprs = {
  alpha?: string;
  x?: string;
  y?: string;
};

const DEFAULT_DELAY = 0.3;
const DEFAULT_DURATION = 0.6;
const DEFAULT_DISTANCE = 60;
const STAGGER_STEP = 0.15;

// Minimal decimal rendering: 0.3 → "0.3", 0.9 → "0.9", avoiding 0.1+0.2 → "0.30000000000000004".
function num(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function normalize(input: RevealInput): Reveal {
  if (typeof input === 'string') {
    return { type: input };
  }

  return input;
}

// 0 before `delay`, a linear 0→1 ramp across `duration`, then 1 — the shape of both the alpha
// fade-in and the motion progress. Unquoted; callers wrap it.
function ramp(delay: number, duration: number): string {
  const end = num(delay + duration);

  return `if(lt(t,${num(delay)}),0,if(lt(t,${end}),(t-${num(delay)})/${num(duration)},1))`;
}

/**
 * Wraps a 0→1 ramp expression `p` in an easing curve: ease-out = 1-(1-p)^3 (decelerates into place),
 * ease-in-out = smoothstep p*p*(3-2p); ease-out-back briefly overshoots travel. This pure expression
 * math adds no filter, so it is LGPL-safe on the on-device build. Linear or unset easing returns
 * the ramp unchanged. Shared with overlayMotionExpr (editor/inputSources.ts)
 * so a caption and a composited overlay with the same reveal settle identically.
 */
export function easeRampExpr(rampExpr: string, easing: RevealEasing | undefined): string {
  if (easing === 'ease-out-back') return `(${rampExpr})*(1+((${rampExpr})-1)*(2.70158*((${rampExpr})-1)-1))`;

  if (easing === 'ease-out') return `1-pow(1-(${rampExpr}),3)`;

  if (easing === 'ease-in-out') return `(${rampExpr})*(${rampExpr})*(3-2*(${rampExpr}))`;

  return rampExpr;
}

function alphaRampExpr(expr: string, easing: RevealEasing | undefined): string {
  return easing === 'ease-out-back' ? `clip((${expr}),0,1)` : expr;
}

// A position expression that starts `distance` px off `base` (on the `sign` side) and eases to `base`
// as the ramp completes. `base` may be a number or an ffmpeg expression, so it is parenthesised.
function offset(base: string | number, sign: '+' | '-', distance: number, rampExpr: string): string {
  return `'(${base})${sign}(1-(${rampExpr}))*${num(distance)}'`;
}

/**
 * Translates a reveal intent into the drawtext expressions an animated entrance needs.
 *
 * - `none` → no expressions (the text is drawn statically).
 * - `fade` → an `alpha` ramp only.
 * - `rise` → `alpha` + a `y` that lifts the text up into place from `distance` px below.
 * - `slide-left` → `alpha` + an `x` entering from `distance` px to the right.
 * - `slide-right` → `alpha` + an `x` entering from `distance` px to the left.
 *
 * `base` is the text's resting position; motion expressions ease from the offset back to it.
 */
export function revealToExpr(
  input: RevealInput | undefined,
  base: { x: string | number; y: string | number }
): RevealExprs {
  if (input === undefined) {
    return {};
  }

  const reveal = normalize(input);

  if (reveal.type === 'none') {
    return {};
  }

  const delay = reveal.delay ?? DEFAULT_DELAY;
  const duration = reveal.duration ?? DEFAULT_DURATION;
  const distance = reveal.distance ?? DEFAULT_DISTANCE;
  const rampExpr = easeRampExpr(ramp(delay, duration), reveal.easing);
  const alpha = `'${alphaRampExpr(rampExpr, reveal.easing)}'`;

  if (reveal.type === 'fade') {
    return { alpha };
  }

  if (reveal.type === 'rise') {
    return { alpha, y: offset(base.y, '+', distance, rampExpr) };
  }

  if (reveal.type === 'slide-left') {
    return { alpha, x: offset(base.x, '+', distance, rampExpr) };
  }

  return { alpha, x: offset(base.x, '-', distance, rampExpr) };
}

// ---------------------------------------------------------------------------
// shared text-block helpers
// ---------------------------------------------------------------------------

// True when a Translation has at least one non-blank value.
export function hasText(text: Translation | undefined): boolean {
  return text !== undefined && Object.values(text).some((value) => typeof value === 'string' && value.trim() !== '');
}

// Merges a reveal's alpha/x/y expressions onto a drawtext values object (mutating it). Shared by
// every text sugar so the reveal wiring lives in exactly one place.
export function applyReveal(
  values: Record<string, unknown>,
  reveal: RevealInput | undefined,
  base: { x: string | number; y: string | number }
): void {
  const exprs = revealToExpr(reveal, base);

  if (exprs.alpha) {
    values.alpha = exprs.alpha;
  }

  if (exprs.x) {
    values.x = exprs.x;
  }

  if (exprs.y) {
    values.y = exprs.y;
  }
}

// An exit animation — fade out (and optionally slide/rise out) starting `after` seconds in (default:
// timed so it ends at the section's end). Same vocabulary as a reveal; a bare type or the full object.
export type Exit = { type: RevealType; after?: number; duration?: number; distance?: number; easing?: RevealEasing };
export type ExitInput = RevealType | Exit;

function normalizeExit(input: ExitInput): Exit {
  if (typeof input === 'string') {
    return { type: input };
  }

  return input;
}

// One animation phase's contribution: its alpha factor and an optional kinetic x/y offset term (already
// signed, to be concatenated onto the running base expression).
type PhaseTerm = { alpha: string; xTerm?: string; yTerm?: string };

// The entrance phase: alpha ramps 0→1 and any offset eases from `distance` back to 0 (the `1-ramp`).
function enterTerm(enter: Reveal): PhaseTerm {
  const r = easeRampExpr(ramp(enter.delay ?? DEFAULT_DELAY, enter.duration ?? DEFAULT_DURATION), enter.easing);
  const dist = num(enter.distance ?? DEFAULT_DISTANCE);
  const ease = `(1-(${r}))*${dist}`;
  const alpha = `(${alphaRampExpr(r, enter.easing)})`;

  if (enter.type === 'rise') return { alpha, yTerm: `+${ease}` };

  if (enter.type === 'slide-left') return { alpha, xTerm: `+${ease}` };

  if (enter.type === 'slide-right') return { alpha, xTerm: `-${ease}` };

  return { alpha };
}

// The exit phase: alpha fades 1→0 and any offset eases from 0 out to `distance` (the bare `ramp`). The
// exit is timed to end at the section end when `after` is omitted.
function exitTerm(ex: Exit, duration: number): PhaseTerm {
  const exDur = ex.duration ?? DEFAULT_DURATION;
  const r = easeRampExpr(ramp(ex.after ?? Math.max(0, duration - exDur), exDur), ex.easing);
  const dist = num(ex.distance ?? DEFAULT_DISTANCE);
  const ease = `(${r})*${dist}`;
  const alpha = `(1-(${alphaRampExpr(r, ex.easing)}))`;

  if (ex.type === 'rise') return { alpha, yTerm: `-${ease}` };

  if (ex.type === 'slide-left') return { alpha, xTerm: `-${ease}` };

  if (ex.type === 'slide-right') return { alpha, xTerm: `+${ease}` };

  return { alpha };
}

/**
 * Combined entrance + exit for a drawtext: `alpha = enterFade * exitFade`, and the position eases out
 * from any entrance offset to the exit offset. Mutates `values`. `duration` is the section length, used
 * to time an exit that ends at the section's end when `after` is omitted.
 */
export function applyAnimation(
  values: Record<string, unknown>,
  reveal: RevealInput | undefined,
  exit: ExitInput | undefined,
  base: { x: string | number; y: string | number },
  duration: number
): void {
  const enter = reveal === undefined ? undefined : normalize(reveal);
  const ex = exit === undefined ? undefined : normalizeExit(exit);

  const phases: PhaseTerm[] = [];

  if (enter && enter.type !== 'none') phases.push(enterTerm(enter));

  if (ex && ex.type !== 'none') phases.push(exitTerm(ex, duration));

  if (phases.length === 0) return;

  values.alpha = `'${phases.map((phase) => phase.alpha).join('*')}'`;

  const position = assemblePosition(phases, base);

  if (position.x) values.x = position.x;

  if (position.y) values.y = position.y;
}

// Concatenate every phase's kinetic x/y term onto the base expression, single-quoting the result (the
// expressions contain commas). Each axis is emitted only when at least one phase moves it.
function assemblePosition(
  phases: PhaseTerm[],
  base: { x: string | number; y: string | number }
): { x?: string; y?: string } {
  const xTerms = phases.flatMap((phase) => (phase.xTerm ? [phase.xTerm] : []));
  const yTerms = phases.flatMap((phase) => (phase.yTerm ? [phase.yTerm] : []));
  const position: { x?: string; y?: string } = {};

  if (xTerms.length > 0) position.x = `'(${base.x})${xTerms.join('')}'`;

  if (yTerms.length > 0) position.y = `'(${base.y})${yTerms.join('')}'`;

  return position;
}

// ---------------------------------------------------------------------------
// text effect — drop shadow + outline for legibility on any background
// ---------------------------------------------------------------------------
//
// `drawtext` carries a drop shadow (`shadowx`/`shadowy`/`shadowcolor`) and an outline
// (`borderw`/`bordercolor`), both core libfreetype, present on every backend. A `TextEffect` lowers to
// those keys so authored sugar text stays readable over busy footage without hand-writing the options.
// (HarfBuzz `text_shaping` is deliberately not exposed — it is off on the host and WASM builds; shadow
// and outline cover legibility everywhere.)

export type TextEffect = {
  /** Drop shadow. `true` = `#000000@0.6` offset 2,2; or customise colour / dx / dy. */
  shadow?: boolean | { color?: string; dx?: number; dy?: number };
  /** Outline. `true` = `#000000` width 2; or customise colour / width. */
  outline?: boolean | { color?: string; width?: number };
};

// Exported so the geometry validator judges an effect by what this lowering actually draws.
export const SHADOW_DEFAULTS = { color: '#000000@0.6', dx: 2, dy: 2 };
export const OUTLINE_DEFAULTS = { color: '#000000', width: 2 };

// Merges a text effect's shadow/outline drawtext keys onto a values object (mutating it). Shared by
// every text sugar so the wiring lives in one place — same shape as `applyReveal`.
export function applyTextEffect(values: Record<string, unknown>, effect: TextEffect | undefined): void {
  if (!effect) {
    return;
  }

  if (effect.shadow) {
    const shadow = effect.shadow === true ? SHADOW_DEFAULTS : { ...SHADOW_DEFAULTS, ...effect.shadow };
    values.shadowcolor = shadow.color;
    values.shadowx = shadow.dx;
    values.shadowy = shadow.dy;
  }

  if (effect.outline) {
    const outline = effect.outline === true ? OUTLINE_DEFAULTS : { ...OUTLINE_DEFAULTS, ...effect.outline };
    values.bordercolor = outline.color;
    values.borderw = outline.width;
  }
}

/**
 * Lowers a reveal intent to a filter timeline gate — the pre-quoted `'gte(t,<delay>)'` an
 * `enable=` option needs (the expression holds a comma). For filters with no alpha expression
 * (drawbox: a solid layer, an accent bar) this is the LGPL-safe way to follow a reveal's timing:
 * the box pops in at the delay instead of appearing before the text/content it accompanies.
 * Returns undefined for no reveal, `none`, or a zero delay, so existing output stays byte-identical.
 */
export function revealEnableExpr(input: RevealInput | undefined): string | undefined {
  if (input === undefined) {
    return undefined;
  }

  const reveal = normalize(input);

  if (reveal.type === 'none') {
    return undefined;
  }

  const delay = reveal.delay ?? DEFAULT_DELAY;

  if (delay <= 0) {
    return undefined;
  }

  return `'gte(t,${num(delay)})'`;
}

// Shifts a reveal's delay by its line index so stacked lines enter in sequence.
export function staggered(reveal: RevealInput, index: number, step = STAGGER_STEP): Reveal {
  const obj = normalize(reveal);
  const baseDelay = obj.delay ?? DEFAULT_DELAY;

  return { ...obj, delay: Number((baseDelay + index * step).toFixed(4)) };
}
