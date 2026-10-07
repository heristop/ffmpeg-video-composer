import type { Graphic } from 'ffmpeg-video-composer/src/schemas/graphics.schemas.ts';
import type { AnimationOverlay } from './templateEditorModel';
import { findEngineEntry } from './animation-library';
import { draftGraphic, type DraftContext } from './fx-draft';

// Playback for the legacy APNG samples: they keep rendering as authored (existing descriptors are never
// rewritten), and a sample picked from the builder's Samples group gets these defaults.
const BUNDLED_DEFAULTS: Record<string, Partial<AnimationOverlay>> = {
  'tap_pulse.apng': { loop: false, loops: 1, persistent: false, opacity: 0.8, fit: 'contain' },
  'shine_sweep.apng': { loop: false, loops: 1, persistent: false, opacity: 0.5, fit: 'contain' },
  'confetti.apng': { loop: false, loops: 1, persistent: false, opacity: 0.85, fit: 'contain' },
  'sparkle.apng': { loop: false, loops: 1, persistent: false, opacity: 0.7, fit: 'contain' },
  'corner_brackets.apng': { opacity: 0.5, fit: 'contain' },
  'glow_border.apng': { opacity: 0.28, fit: 'contain' },
};

/** Apply curated playback only to canonical bundled URLs; custom assets keep their authored options. */
export function animationDefaultsForUrl(url: string): Partial<AnimationOverlay> {
  const prefix = '/assets/animations/';

  if (!url.startsWith(prefix)) return {};

  return { ...BUNDLED_DEFAULTS[url.slice(prefix.length)] };
}

export interface AnimationEffectPreset {
  id: string;
  nameKey: string;
  descriptionKey: string;
  /** The graphics the recipe adds to the section: engine primitives anchored to its default target. */
  build: (context: DraftContext) => Graphic[];
}

/** One part of a recipe: a library entry and what the recipe sets on top of the drafted placement. */
type RecipePart = [entryId: string, overrides?: Record<string, unknown>];

function graphicsOf(section: DraftContext['section']): Graphic[] {
  return ('graphics' in section ? section.graphics : undefined) ?? [];
}

// Draft each part against the section as it grows, so every part gets its own seed and the context
// (target, size, section length) a library pick would have given it.
function composeRecipe(parts: RecipePart[], context: DraftContext): Graphic[] {
  const added: Graphic[] = [];

  for (const [entryId, overrides] of parts) {
    const entry = findEngineEntry(entryId);

    if (!entry) continue;

    const section = { ...context.section, graphics: [...graphicsOf(context.section), ...added] };

    added.push({ ...draftGraphic(entry, { ...context, section }), ...overrides });
  }

  return added;
}

function recipe(id: string, parts: RecipePart[]): AnimationEffectPreset {
  return {
    id,
    nameKey: `animation.effects.${id}.name`,
    descriptionKey: `animation.effects.${id}.description`,
    build: (context) => composeRecipe(parts, context),
  };
}

/**
 * Two-part recipes composed from engine primitives (at most two layered effects per beat). Each part lands
 * on the section's default target with context-derived parameters; the author then tunes it like any pick.
 */
export const ANIMATION_EFFECT_PRESETS: AnimationEffectPreset[] = [
  recipe('interface-focus', [
    ['corners', { at: 0.15 }],
    ['ripple-tap', { at: 0.45 }],
  ]),
  recipe('product-spotlight', [
    ['sheen', { at: 0.3 }],
    ['glint-orbit', { at: 0.9 }],
  ]),
  recipe('celebration-burst', [
    ['confetti', { at: 0.2 }],
    ['glint', { at: 0.7 }],
  ]),
  recipe('focus-lock', [
    ['corners', { at: 0.1, trace: 'together' }],
    ['ripple', { at: 0.35 }],
  ]),
  recipe('light-pass', [['leak'], ['glint', { at: 0.6, path: 'scatter' }]]),
  recipe('frame-reveal', [
    ['frame', { at: 0.1 }],
    ['sheen', { at: 0.75 }],
  ]),
];
