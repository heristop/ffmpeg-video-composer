// The fx vocabulary as the motion catalog presents it: primitives with open parameters and design intent,
// not a menu of finished looks. Derived from schemas/fx-primitives.schemas.ts (fields, defaults) and
// schemas/fx-docs.ts (their prose), so a new primitive shows up here with its fields and notes as soon as
// its rows exist.

import type { z } from 'zod';
import {
  FX_PRIMITIVES,
  FxTargetSchema,
  fxSharedFields,
  type FxDefaults,
  type FxIntent,
} from '../../schemas/fx.schemas';
import { FX_DOCS, describeFxPrimitives } from '../../schemas/fx-docs';
import { LIBRARY_ANIMATION_SAMPLES, LIBRARY_SAMPLE_NOTE, type LibrarySample } from './library-samples';

export interface FxPrimitiveEntry extends FxIntent {
  /** Primitive-specific fields → what each does (range and default included). */
  params: Record<string, string>;
  defaults: FxDefaults;
}

export interface FxCatalog {
  description: string;
  rules: string[];
  targets: string;
  /** Fields every primitive takes. */
  shared: Record<string, string>;
  primitives: Record<string, FxPrimitiveEntry>;
}

const RULES = [
  'Compose, do not pick: set the parameters that define the look (each primitive lists them under `vary`) for ' +
    'THIS template; an untuned fx only gets context defaults.',
  'Anchor every effect with `target` (a card rect with its radius, a pane, a layer, a kinetic block, or the frame) ' +
    'and derive it from what it decorates, never a floating box.',
  'Light (sheen, leak, edge-glow) adds luminance, never greys: it stays inside its target (an edge-glow blooms ' +
    'just outside the card), peaks ≤ 0.35 alpha (leak ≤ 0.25) and ≤ 0.6 intensity over skin.',
  'Marks (ripple, glint, confetti) start from a point of the target and may leave it: a ripple on the exact ' +
    'control, glints on a product, confetti once per video on a real payoff.',
  'Ambient textures (bokeh, dust, grain, bloom, vignette-breathe) stay ≤ 0.12, last the section and are dropped ' +
    'in reduced motion: at most one per section, never on UI or text-heavy cards.',
  'Surfaces (glass, resolve) rework the pixels inside the target: a frosted plate under text, a logo that lands ' +
    'in focus. Keep the text on them legible and give a kinetic entrance or a resolve, not both.',
  'One hero effect per beat, at most two layered (ambient textures count); land it on the beat its target ' +
    'resolves (`at: "card.end"`).',
  'Tie colour to the palette ("$color.accent", "$color.fg") and speed to the motion energy and tokens ($smooth, ' +
    '$expo); vary `seed` to re-roll context defaults: the same descriptor always renders the same pixels.',
];

function describe(shape: z.ZodRawShape): Record<string, string> {
  return Object.fromEntries(
    Object.entries(shape).map(([key, schema]) => [key, (schema as z.ZodType).description ?? ''])
  );
}

/** The creative kit's library animations, labelled as samples and mapped to the primitives that replace them. */
export interface SamplesCatalog {
  note: string;
  animations: LibrarySample[];
}

export function samplesCatalog(): SamplesCatalog {
  return { note: LIBRARY_SAMPLE_NOTE, animations: LIBRARY_ANIMATION_SAMPLES };
}

export function fxCatalog(): FxCatalog {
  describeFxPrimitives();

  return {
    description:
      'section.graphics[] entries { type: "fx", effect, ...parameters }: procedural light primitives lowered at ' +
      'output resolution, clipped to a target, deterministic from global.seed.',
    rules: RULES,
    targets: FxTargetSchema.description ?? '',
    shared: fxSharedFields(),
    primitives: Object.fromEntries(
      Object.entries(FX_PRIMITIVES).map(([name, row]) => [
        name,
        { ...FX_DOCS[name as keyof typeof FX_DOCS].intent, params: describe(row.params), defaults: row.defaults },
      ])
    ),
  };
}
