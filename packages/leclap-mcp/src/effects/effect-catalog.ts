import { z } from 'zod';
import { getCustomEffectDefinitions, EFFECT_OUTPUT, type JsonEffectCatalog } from './custom-effect-catalog.js';
import { templateRevision } from './template-revision.js';
import {
  TITLE_EFFECT_ID,
  TITLE_EFFECT_VERSION,
  TITLE_COMPOSITION_ID,
  titlePropsSchema,
  titleAssetsSchema,
} from './title-definition.js';
import {
  PROMO_EFFECT_ID,
  PROMO_EFFECT_VERSION,
  PROMO_COMPOSITION_ID,
  promoPropsSchema,
  promoAssetsSchema,
} from './promo-registry.js';
const images = ['.png', '.jpg', '.jpeg', '.webp'];
const fonts = ['.ttf', '.otf', '.woff', '.woff2'];
export { EFFECT_OUTPUT } from './custom-effect-catalog.js';
const definitions = [
  {
    id: TITLE_EFFECT_ID,
    version: TITLE_EFFECT_VERSION,
    compositionId: TITLE_COMPOSITION_ID,
    props: titlePropsSchema,
    assets: titleAssetsSchema,
    output: EFFECT_OUTPUT,
    assetExtensions: { background: ['.mp4', '.mov', '.webm', '.m4v'], logo: images, font: fonts } as Record<
      string,
      readonly string[]
    >,
    assetVideoPolicies: { background: { minVideoDurationSeconds: 10 } } as Record<
      string,
      { minVideoDurationSeconds: number }
    >,
    timing: 'logoDelayFrames + entranceDurationFrames must be <= 300.',
    assetRestrictions:
      'Absolute regular local files within mediaDir, realpath-contained. Background video (.mp4/.mov/.webm/.m4v) >=10s; logo .png/.jpg/.jpeg/.webp; font .ttf/.otf/.woff/.woff2. Extra props/assets rejected. No remote scene assets.',
  },
  {
    id: PROMO_EFFECT_ID,
    version: PROMO_EFFECT_VERSION,
    compositionId: PROMO_COMPOSITION_ID,
    props: promoPropsSchema,
    assets: promoAssetsSchema,
    output: EFFECT_OUTPUT,
    assetExtensions: { screenshot: images, logo: images, font: fonts } as Record<string, readonly string[]>,
    assetVideoPolicies: {} as Record<string, { minVideoDurationSeconds: number }>,
    timing: 'ctaStartFrame - showcaseStartFrame must be >= 90.',
    assetRestrictions:
      'Absolute regular local files within mediaDir, realpath-contained. Screenshot and logo .png/.jpg/.jpeg/.webp; font .ttf/.otf/.woff/.woff2. Extra props/assets rejected. No remote scene assets. displayUrl is text only; never fetched.',
  },
].map((definition) => ({
  ...definition,
  definitionHash: templateRevision({
    id: definition.id,
    version: definition.version,
    compositionId: definition.compositionId,
    propsSchema: z.toJSONSchema(definition.props),
    assetsSchema: z.toJSONSchema(definition.assets),
    output: definition.output,
    timing: definition.timing,
    assetExtensions: definition.assetExtensions,
    assetVideoPolicies: definition.assetVideoPolicies,
  }),
}));
export interface EffectDefinition {
  id: string;
  version: string;
  compositionId: string;
  description?: string;
  definitionHash: string;
  props: z.ZodType<Record<string, unknown>>;
  assets: z.ZodType<Record<string, string>>;
  output: typeof EFFECT_OUTPUT;
  assetExtensions: Record<string, readonly string[]>;
  assetVideoPolicies: Record<string, { minVideoDurationSeconds: number }>;
  timing: string;
  assetRestrictions: string;
}
type BuiltinEffectDefinition = (typeof definitions)[number];
export function listEffectDefinitions(): readonly BuiltinEffectDefinition[];
export function listEffectDefinitions(custom: JsonEffectCatalog | undefined): readonly EffectDefinition[];
export function listEffectDefinitions(custom?: JsonEffectCatalog): readonly EffectDefinition[] {
  return custom ? [...definitions, ...getCustomEffectDefinitions(custom)] : [...definitions];
}
export function getEffectDefinition(id: string, version: string): BuiltinEffectDefinition;
export function getEffectDefinition(
  id: string,
  version: string,
  custom: JsonEffectCatalog | undefined
): EffectDefinition;
export function getEffectDefinition(id: string, version: string, custom?: JsonEffectCatalog): EffectDefinition {
  const available = listEffectDefinitions(custom);
  const definition = available.find((entry) => entry.id === id && entry.version === version);

  if (!definition) {
    throw new Error(
      `effect_not_registered: ${id}@${version}; supported ${available.map((entry) => `${entry.id}@${entry.version}`).join(', ')}.`
    );
  }

  return definition;
}
