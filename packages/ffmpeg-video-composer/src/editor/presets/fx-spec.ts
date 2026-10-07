// The `fx` graphic as the graphics table (graphics.ts) sees it: timing for the motion timeline and a
// `render` that hands the element to the compile path's fx lowering (editor/presets/fx.ts, reached through
// SugarContext.masks.effects). Deliberately tiny: this module sits in the browser's eager load, the effect
// modules do not.

import { FX_PRIMITIVES } from '../../schemas/fx.schemas';
import type { Base, Frame, GraphicEnv, GraphicWindow, Of, Spec } from './graphics-spec';

/** Passes after the first start `every` seconds apart (default: one pass plus a 1.2 s rest). */
export const FX_PASS_REST = 1.2;

/** Seconds from the first pass start to the end of the last one, before any energy scaling. */
export function fxSpan(g: Of<'fx'>): number {
  const duration = g.duration ?? FX_PRIMITIVES[g.effect].defaults.duration;
  const passes = g.repeat ?? 1;

  return (passes - 1) * (g.every ?? duration + FX_PASS_REST) + duration;
}

function render(g: Of<'fx'>, window: GraphicWindow, env: GraphicEnv) {
  const site = env.site;
  const lower = site?.ctx.masks?.effects;

  return site && lower ? lower({ graphic: g, ...window, seed: env.seed, ...site }) : [];
}

export function fxSpec(g: Of<'fx'>, _frame: Frame, base: Base): Spec {
  const text = typeof g.target === 'string' && g.target.startsWith('text:');

  return {
    ...base,
    duration: fxSpan(g),
    ease: g.ease ?? FX_PRIMITIVES[g.effect].defaults.ease,
    color: g.color ?? '#FFFFFF',
    above: g.above ?? text,
    holds: false,
    rects: () => [],
    render: (window, env) => render(g, window, env),
  };
}
