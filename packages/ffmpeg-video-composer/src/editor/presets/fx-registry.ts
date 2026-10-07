// The fx primitives with a lowering, one line each (fx.ts dispatches through it; see its EXTENSION
// CONTRACT). The order follows FX_PRIMITIVES (schemas/fx-primitives.schemas.ts).

import type { FxEffectName } from '../../schemas/fx.schemas';
import type { FxEffect } from './fx-kit';
import { SHEEN } from './fx-sheen';
import { RIPPLE } from './fx-ripple';
import { GLINT } from './fx-glint';
import { CONFETTI } from './fx-confetti';
import { BOKEH, DUST } from './fx-particles';
import { GLASS } from './fx-glass';
import { RESOLVE } from './fx-resolve';
import { LEAK } from './fx-leak';
import { EDGE_GLOW } from './fx-edge-glow';
import { BLOOM } from './fx-bloom';
import { VIGNETTE_BREATHE } from './fx-vignette';
import { GRAIN } from './fx-grain';

/** The registry: one line per primitive. */
export const FX_EFFECTS: { readonly [N in FxEffectName]?: FxEffect<N> } = {
  sheen: SHEEN,
  ripple: RIPPLE,
  glint: GLINT,
  confetti: CONFETTI,
  bokeh: BOKEH,
  dust: DUST,
  glass: GLASS,
  resolve: RESOLVE,
  leak: LEAK,
  'edge-glow': EDGE_GLOW,
  bloom: BLOOM,
  'vignette-breathe': VIGNETTE_BREATHE,
  grain: GRAIN,
};
