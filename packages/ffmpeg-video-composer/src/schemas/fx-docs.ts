// ── fx prose: what every fx field does and each primitive's design intent ───────
//
// One row per primitive of FX_PRIMITIVES (fx-primitives.schemas.ts), typed so a primitive without a row,
// or a field without a description, fails to compile. Kept out of the schema rows: the browser validates
// templates synchronously with the schemas alone, and this prose (the bulk of each row) is read only by the
// JSON schema (template.schemas.ts) and the motion catalog (core/motion/fx-catalog.ts), which attach it
// with describeFxPrimitives() first. The text reaches the JSON schema exactly as a `.describe()` would.
import { z } from 'zod';
import { FX_PRIMITIVES, type FxDoc, type FxEffectName } from './fx-primitives.schemas';
import { FxGraphicSchema } from './fx.schemas';
import { confettiDoc, glintDoc, rippleDoc } from './fx-celebrate.docs';
import { bokehDoc, dustDoc } from './fx-particles.docs';
import { glassDoc, resolveDoc } from './fx-surface.docs';
import { edgeGlowDoc, leakDoc } from './fx-light.docs';
import { bloomDoc, grainDoc, vignetteBreatheDoc } from './fx-ambient.docs';

const sheenDoc = {
  params: {
    profile:
      'Light profile across the band: specular (tight gaussian core + a bloom twice as wide, default: glass, ' +
      'metal, screens), soft (one wide gaussian wash: paper, fabric, matte cards), twin (two thin parallel ' +
      'glints: chrome, lenses, techy UI).',
    width:
      "Band width as a fraction of the target's short side (default ~0.15, varied by target shape and seed). " +
      '0.05–0.1 = a crisp glint, 0.2–0.4 = a broad wash.',
    tilt:
      'Band angle in degrees off the perpendicular of its travel (default 14–26, from the seed). 0 = square ' +
      'to the path; negative leans the other way.',
    direction:
      'Travel path across the target (default: right on wide targets, down on tall ones). Match the ' +
      "scene's motion or reading direction.",
    bloom: 'Share of the peak carried by the soft bloom around a specular core (default 0.25; 0 = bare core).',
  },
  intent: {
    summary:
      'A specular light band that crosses its target once (or `repeat` times), clipped to the target shape: light on the glass of a card, a screen, a product shot or the letters of a title.',
    useWhen: 'a hero object lands or resolves; a CTA card or price settles; a title locks up',
    avoidWhen: 'over faces or footage with skin (keep intensity ≤ 0.6 there); more than one sheen per beat',
    vary: 'profile and width set the material (crisp glint vs. broad wash); tilt and direction set the light source; colour (e.g. "$color.accent") tints it; duration and ease set the speed (0.6–0.9 s reads as a glint, 1.2 s+ as a slow reflection); repeat + every turn it into a periodic glint.',
    reduced: 'a static 8% highlight that fades in and out on the target',
  },
} satisfies FxDoc<(typeof FX_PRIMITIVES)['sheen']['params']>;

/** Every primitive's prose, keyed by `effect`. Adding a primitive: its row here, next to its schema row. */
export const FX_DOCS: { [N in FxEffectName]: FxDoc<(typeof FX_PRIMITIVES)[N]['params']> } = {
  sheen: sheenDoc,
  ripple: rippleDoc,
  glint: glintDoc,
  confetti: confettiDoc,
  bokeh: bokehDoc,
  dust: dustDoc,
  glass: glassDoc,
  resolve: resolveDoc,
  leak: leakDoc,
  'edge-glow': edgeGlowDoc,
  bloom: bloomDoc,
  'vignette-breathe': vignetteBreatheDoc,
  grain: grainDoc,
};

// What `.describe(text)` records, on the schema itself (keeping any metadata it has, e.g. an id).
function describeSchema(schema: z.ZodType, description: string): void {
  z.globalRegistry.add(schema, { ...z.globalRegistry.get(schema), description });
}

let described = false;

/**
 * Attaches FX_DOCS to the fx schemas: each field's description, and each primitive's summary and tuning
 * note on its fx graphic variant. Idempotent; call it before reading those descriptions.
 */
export function describeFxPrimitives(): void {
  if (described) return;

  described = true;

  for (const variant of FxGraphicSchema.options) {
    const effect = variant.shape.effect.value;
    const doc: FxDoc = FX_DOCS[effect];
    const params: z.ZodRawShape = FX_PRIMITIVES[effect].params;

    for (const [field, description] of Object.entries(doc.params)) {
      describeSchema(params[field] as z.ZodType, description);
    }

    describeSchema(variant, `${doc.intent.summary} Tune: ${doc.intent.vary}`);
  }
}
