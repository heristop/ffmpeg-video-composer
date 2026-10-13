// Flat fx targets and the ceiling an fx element may reach on them. A primitive can declare a raised
// ceiling for one profile meant for flat graphics (FxDefaults.flat: the sheen's "gloss"); it applies only
// on a flat target (a layer, a text block or a rectangle), never on the frame or a pane, where footage and
// skin may sit under the light. Shared by the lowering (editor/presets/fx.ts) and the lint
// (services/sameness-lint.ts: fx_gloss_target).

import { FX_PRIMITIVES, type FxDefaults } from './fx-primitives.schemas';

/** A layer, a kinetic text block or an explicit rectangle: a graphic, not footage. */
export function isFlatFxTarget(target: unknown): boolean {
  if (typeof target === 'object' && target !== null) return true;

  return typeof target === 'string' && (target.startsWith('layer:') || target.startsWith('text:'));
}

/** The raised profile this element asks for but cannot have (it targets the frame or a pane), if any. */
export function deniedFlatProfile(graphic: { effect?: unknown; profile?: unknown; target?: unknown }): string | null {
  const row = (FX_PRIMITIVES as Partial<Record<string, { defaults: FxDefaults }>>)[String(graphic.effect)];
  const defaults = row?.defaults;
  const flat = defaults?.flat;

  if (!flat || graphic.profile !== flat.profile || isFlatFxTarget(graphic.target)) return null;

  return flat.profile;
}

/** The peak alpha this element reaches at intensity 1. */
export function fxCeiling(graphic: { effect: string; profile?: unknown; target?: unknown }): number {
  const defaults = (FX_PRIMITIVES as Record<string, { defaults: FxDefaults }>)[graphic.effect].defaults;
  const flat = defaults.flat;

  if (flat && graphic.profile === flat.profile && isFlatFxTarget(graphic.target)) return flat.ceiling;

  return defaults.ceiling;
}
