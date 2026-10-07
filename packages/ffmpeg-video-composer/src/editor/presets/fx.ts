// fx graphics → one engine sub-graph per element (section.graphics[] entries with `type: "fx"`).
//
// EXTENSION CONTRACT (adding a primitive, e.g. "leak"):
//   1. schemas/fx-primitives.schemas.ts: one row in FX_PRIMITIVES — its own zod fields (every look-defining
//      parameter, all optional) and its defaults (duration at energy 1, ease, doctrine ceiling, default
//      intensity); and its prose in FX_DOCS (schemas/fx-docs.ts): each field's description (its range and
//      what it changes) and its design intent (summary, useWhen, avoidWhen, vary, reduced). The schema, the
//      JSON schema and the motion catalog derive from them; the browser's validation loads only the first.
//   2. editor/presets/fx-<name>.ts: export an FxEffect (fx-kit.ts). `lower(fx)` gets an FxContext with the
//      target already resolved and snapped, timing on the frame grid, colour/peak/seed/energy resolved, and a
//      seeded `random` for context defaults; it returns light layers (or null to skip after a warning) and
//      lets `lightInTarget` crop, clip and composite them. Derive omitted parameters from the context
//      (target size and aspect, fx.random, fx.energy, fx.color) so untuned effects differ per template.
//      Use only on-device filters (scripts/ffmpeg/common.sh), gate optional ones with `fx.has(...)` and
//      keep a fallback (compile-time sprites: fx-sprites.ts, fx.sprite). Honour `fx.reduced` (return [] for
//      "absent": no warning). Light built from the picture itself (halation, grain) asks the kit for copies of
//      the region through a layer's `taps`; marks or light that leave the target (a ring, confetti, a glow
//      around a card) widen the composited region with fx-kit's `drawIn` (unmasked, clamped to the frame).
//   3. One line in FX_EFFECTS (fx-registry.ts). Then add the primitive to tests/lgpl-filter-audit.test.ts (FX_AUDIT).
//
// The dispatcher owns everything shared: target resolution (fx-target.ts), timing (`at` snapped to a frame,
// one pass = whole frames, `repeat`/`every`, `until`), energy-scaled default duration, colour (theme tokens
// are resolved upstream; the default is a warm white tinted by the theme accent), intensity under the
// ceiling, the element seed (global.seed + path + its own `seed`), capability checks and warnings.
// This module and the effects are reached only from the compile path (compositing.ts), never eagerly.

import type { Filter } from '@/core/types';
import { fnv1a32, seededRandom } from '@/core/determinism/hash';
import { FX_PRIMITIVES, type FxEffectName } from '../../schemas/fx.schemas';
import { FX_PASS_REST } from './fx-spec';
import { defaultLightColor, WARM_WHITE } from './fx-color';
import { resolveFxTarget, type FxTargetRect } from './fx-target';
import { spriteUrl } from './fx-sprites';
import { lightInTarget, type AnyFxContext, type FxEffect } from './fx-kit';
import { FX_EFFECTS } from './fx-registry';
import type { FxRequest } from './sugar-context';

export { defaultLightColor } from './fx-color';

/** Names of the primitives with a lowering (the rest of FX_PRIMITIVES validate but render nothing yet). */
export const REGISTERED_FX = Object.keys(FX_EFFECTS) as FxEffectName[];

function warn(request: FxRequest, code: string, message: string): void {
  request.ctx.masks?.warn(`[${code}] graphics[${request.index}] fx "${request.graphic.effect}": ${message}`);
}

function lightColor(request: FxRequest): string {
  const authored = request.graphic.color;

  if (!authored) return defaultLightColor(request.ctx.theme);

  return (request.ctx.masks?.color(authored) ?? authored).split('@')[0] || WARM_WHITE;
}

function onGrid(seconds: number, fps: number): number {
  return Math.round(seconds * fps) / fps;
}

interface Timing {
  at: number;
  duration: number;
  passes: number;
  every: number;
  end: number;
}

function timing(request: FxRequest, energy: number): Timing | null {
  const { graphic: g, ctx } = request;
  const defaults = FX_PRIMITIVES[g.effect].defaults;
  const scaled = defaults.duration / Math.sqrt(Math.min(2, Math.max(0.5, energy || 1)));
  const duration = Math.max(2, Math.round((g.duration ?? scaled) * ctx.fps)) / ctx.fps;
  const at = onGrid(request.at, ctx.fps);
  const passes = g.repeat ?? 1;
  const every = Math.max(duration, onGrid(g.every ?? duration + FX_PASS_REST, ctx.fps));
  const last = at + (passes - 1) * every + duration;
  const end = request.until === undefined ? last : Math.min(last, onGrid(request.until, ctx.fps));

  return end > at ? { at, duration, passes, every, end } : null;
}

function context(request: FxRequest, target: FxTargetRect, time: Timing): AnyFxContext {
  const { graphic: g, ctx, index } = request;
  const [width, height] = ctx.scale.split(':').map(Number);
  const defaults = FX_PRIMITIVES[g.effect].defaults;
  const energy = ctx.motion?.energy ?? 1;
  const seed = g.seed === undefined ? request.seed : fnv1a32(`${request.seed}:${g.seed}`);
  const masks = ctx.masks;

  return {
    graphic: g,
    target,
    frame: { width, height, fps: ctx.fps },
    ...time,
    ease: g.ease ?? defaults.ease,
    color: lightColor(request),
    theme: ctx.theme,
    peak: defaults.ceiling * (g.intensity ?? defaults.intensity),
    energy,
    reduced: energy === 0,
    seed,
    random: seededRandom(fnv1a32(`${seed}:defaults`)),
    prefix: `fx${index}_`,
    has: (filter) => masks?.has?.(filter) ?? true,
    sprite: (key, spec) => masks?.input(`fx${index}_${key}`, { url: spriteUrl(spec), still: true }) ?? null,
  };
}

// The target, or null (with a warning) when it names nothing or needs a mask this build cannot draw.
function targetOf(request: FxRequest): FxTargetRect | null {
  const target = resolveFxTarget(request.graphic.target, { section: request.section, ctx: request.ctx });

  if (!target) {
    warn(request, 'fx_target', 'the target names nothing in this section (or lies outside the frame); skipped');

    return null;
  }

  if (target.mask !== 'none' && request.ctx.masks?.available !== true) {
    warn(request, 'mask_unavailable', 'a shaped target needs alphamerge, absent from this FFmpeg build; skipped');

    return null;
  }

  return target;
}

/** One fx graphic as filters: a single sub-graph, or nothing (with a warning) when it cannot render. */
export function lowerFx(request: FxRequest): Filter[] {
  const effect: FxEffect<FxEffectName> | undefined = FX_EFFECTS[request.graphic.effect];

  if (!effect) {
    warn(request, 'fx_unavailable', 'this primitive has no lowering in this engine version; skipped');

    return [];
  }

  const target = targetOf(request);
  const time = timing(request, request.ctx.motion?.energy ?? 1);

  if (!target || !time) return [];

  const fx = context(request, target, time);
  const layers = effect.lower(fx);

  // An empty list is a deliberate "nothing" (ambient particles or texture under reduced motion): no warning.
  if (layers?.length === 0) return [];

  const graph = layers ? lightInTarget(fx, layers) : null;

  if (!graph) {
    warn(request, 'fx_skipped', 'this build or segment cannot draw it (missing filter or extra input); skipped');

    return [];
  }

  return [{ type: 'graph', graph }];
}
