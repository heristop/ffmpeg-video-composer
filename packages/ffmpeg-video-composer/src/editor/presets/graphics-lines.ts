// The stroke graphics as the graphics table (graphics.ts) sees them: underline, frame and corners. Their
// `render` hands the element to the compile path's stroke lowering (stroke-graphics.ts, reached through
// SugarContext.masks.strokes so it stays out of the browser's eager load). The rectangles below are only
// their footprint for the motion timeline and geometry checks; they are never drawn. The defaults live here
// so the timeline and the lowering agree on the duration.

import {
  BRAND,
  INK,
  withAlpha,
  type Base,
  type Frame,
  type GraphicEnv,
  type GraphicWindow,
  type Of,
  type Rect,
  type Spec,
} from './graphics-spec';

export type StrokeType = 'frame' | 'corners' | 'underline';
export type StrokeGraphic = Of<StrokeType>;

/** Defaults per type: entrance seconds, ease, exit. */
export const STROKE_DEFAULTS = {
  frame: { duration: 0.6, ease: 'cubic-bezier(0.16, 1, 0.3, 1)', exit: 'fade' },
  corners: { duration: 0.5, ease: 'spring(420, 30)', exit: 'expand' },
  underline: { duration: 0.5, ease: 'cubic-bezier(0.16, 1, 0.3, 1)', exit: 'fade' },
} as const;

function growFrom(origin: 'left' | 'center' | 'right', x: number, width: number, p: number): { x: number; w: number } {
  const w = width * p;

  if (origin === 'center') return { x: x + (width - w) / 2, w };

  return origin === 'right' ? { x: x + width - w, w } : { x, w };
}

// Progress of the k-th quarter of a clockwise trace.
function quarter(p: number, k: number): number {
  return Math.max(0, Math.min(1, p * 4 - k));
}

// Clockwise trace: top (left→right), right (top→bottom), bottom (right→left), left (bottom→top).
function frameRects(inset: number, t: number, frame: Frame, p: number): Rect[] {
  const [left, top] = [inset, inset];
  const [w, h] = [frame.width - 2 * inset, frame.height - 2 * inset];

  return [
    { x: left, y: top, w: w * quarter(p, 0), h: t },
    { x: left + w - t, y: top, w: t, h: h * quarter(p, 1) },
    { x: left + w - w * quarter(p, 2), y: top + h - t, w: w * quarter(p, 2), h: t },
    { x: left, y: top + h - h * quarter(p, 3), w: t, h: h * quarter(p, 3) },
  ];
}

function cornerRects(inset: number, length: number, t: number, frame: Frame, p: number): Rect[] {
  const l = length * p;
  const [r, b] = [frame.width - inset, frame.height - inset];

  return [
    { x: inset, y: inset, w: l, h: t },
    { x: inset, y: inset, w: t, h: l },
    { x: r - l, y: inset, w: l, h: t },
    { x: r - t, y: inset, w: t, h: l },
    { x: inset, y: b - t, w: l, h: t },
    { x: inset, y: b - l, w: t, h: l },
    { x: r - l, y: b - t, w: l, h: t },
    { x: r - t, y: b - l, w: t, h: l },
  ];
}

// Without the compile path's lowering (validation, timelines) a stroke draws nothing.
function render(g: StrokeGraphic) {
  return (window: GraphicWindow, env: GraphicEnv) => {
    const site = env.site;
    const lower = site?.ctx.masks?.strokes;

    return site && lower ? (lower({ graphic: g, ...window, seed: env.seed, ...site }) ?? []) : [];
  };
}

function strokeSpec(g: StrokeGraphic, base: Base, color: string, rects: Spec['rects']): Spec {
  const defaults = STROKE_DEFAULTS[g.type];

  return {
    ...base,
    duration: g.duration ?? defaults.duration,
    ease: g.ease ?? defaults.ease,
    color,
    rects,
    render: render(g),
  };
}

export function underlineSpec(g: Of<'underline'>, frame: Frame, base: Base): Spec {
  const x = g.x ?? frame.width * 0.08;
  const width = g.width ?? frame.width * 0.3;
  const y = g.y ?? frame.height * 0.62;
  const thickness = g.thickness ?? 6;

  // An underline draws above text by default: a CTA card or plate drawn with the text never hides it.
  return strokeSpec(g, { ...base, above: g.above ?? true }, g.color ?? BRAND, (p) => [
    { ...growFrom(g.origin ?? 'left', x, width, p), y, h: thickness },
  ]);
}

export function frameSpec(g: Of<'frame'>, frame: Frame, base: Base): Spec {
  return strokeSpec(g, base, g.color ?? withAlpha(INK, 0.9), (p) =>
    frameRects(g.inset ?? 48, g.thickness ?? 4, frame, p)
  );
}

export function cornersSpec(g: Of<'corners'>, frame: Frame, base: Base): Spec {
  return strokeSpec(g, base, g.color ?? INK, (p) =>
    cornerRects(g.inset ?? 56, g.length ?? 72, g.thickness ?? 4, frame, p)
  );
}
