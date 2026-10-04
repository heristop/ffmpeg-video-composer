// Schema-derived control metadata for the six builder features that gain (or already have) parity
// panels across web and Expo: chromaKey, titleCard, lowerThird, speed, captureMode and overlay flip.
// Every enum/range/default is read off the engine's generated JSON schema at module load via the
// schema-walk primitives — never hand-copied — so a schema change that removes/renames a field turns
// into an import-time throw here instead of a silent authoring drift (same philosophy as the
// capability matrix). Consumed by both apps' field panels; UI-free.
import { templateDescriptorJsonSchema } from 'ffmpeg-video-composer/src/schemas/template.schemas.ts';
import { type JsonSchemaNode, resolveFieldPath, enumOf, rangeOf } from './schema-walk';
import { RATE_STOPS, NORMAL_RATE_INDEX } from './speed-rate';

const schema = templateDescriptorJsonSchema as unknown as JsonSchemaNode;

export type ControlKind = 'slider' | 'segmented' | 'toggle' | 'text' | 'color' | 'chips';

export interface ControlSpec {
  /** Dot path inside the descriptor section (e.g. 'chromaKey.similarity', 'options.speed'). */
  fieldPath: string;
  control: ControlKind;
  /** i18n key SUFFIX; web prefixes with the admin namespace group, expo with the editor group. */
  labelKey: string;
  /** Derived from the JSON schema at module load — never hardcoded. */
  enumValues?: readonly string[];
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: unknown;
}

export type FeatureKey =
  | 'chromaKey'
  | 'titleCard'
  | 'lowerThird'
  | 'speed'
  | 'captureMode'
  | 'flip'
  | 'grain'
  | 'letterbox'
  | 'shake'
  | 'pulse'
  | 'audioEffect';

// Resolves a spec's schema node through the same path the conformance test re-checks
// (resolveFieldPath), throwing immediately if a field has drifted out of the schema — a build
// failure at import time rather than a runtime surprise in either app's builder.
function node(feature: FeatureKey, fieldPath: string): JsonSchemaNode {
  const found = resolveFieldPath(schema, feature, fieldPath);

  if (!found) throw new Error(`control-metadata: ${feature}.${fieldPath} does not resolve against the schema`);

  return found;
}

function colorSpec(feature: FeatureKey, fieldPath: string, labelKey: string): ControlSpec {
  node(feature, fieldPath);

  return { fieldPath, control: 'color', labelKey };
}

function textSpec(feature: FeatureKey, fieldPath: string, labelKey: string): ControlSpec {
  node(feature, fieldPath);

  return { fieldPath, control: 'text', labelKey };
}

function sliderSpec(feature: FeatureKey, fieldPath: string, labelKey: string): ControlSpec {
  const range = rangeOf(node(feature, fieldPath));

  return { fieldPath, control: 'slider', labelKey, min: range.min, max: range.max, defaultValue: range.default };
}

function enumSpec(
  feature: FeatureKey,
  fieldPath: string,
  labelKey: string,
  control: 'segmented' | 'chips'
): ControlSpec {
  const enumValues = enumOf(node(feature, fieldPath));

  if (!enumValues) throw new Error(`control-metadata: ${feature}.${fieldPath} has no schema enum values`);

  return { fieldPath, control, labelKey, enumValues };
}

// options.speed is a PTS multiplier (2 = SLOW motion — inverted from the schema's own wording) with
// no declared min/max in the schema (just `.positive()`); the descriptor semantics forbid exposing
// the raw multiplier in any UI. The slider instead steps through the shared RATE_STOPS friendly rate
// table (speed-rate.ts) — schema-adjacent, not a fresh hardcoded copy. `node()` still guards that
// options.speed itself hasn't drifted out of the schema.
function speedSpec(feature: FeatureKey, fieldPath: string, labelKey: string): ControlSpec {
  node(feature, fieldPath);

  return {
    fieldPath,
    control: 'slider',
    labelKey,
    min: 0,
    max: RATE_STOPS.length - 1,
    step: 1,
    defaultValue: NORMAL_RATE_INDEX,
  };
}

export const FEATURE_CONTROLS: Record<FeatureKey, ControlSpec[]> = {
  chromaKey: [
    colorSpec('chromaKey', 'chromaKey.color', 'chromaKey.keyColor'),
    colorSpec('chromaKey', 'chromaKey.background', 'chromaKey.background'),
    sliderSpec('chromaKey', 'chromaKey.similarity', 'chromaKey.similarity'),
  ],
  titleCard: [
    textSpec('titleCard', 'titleCard.kicker', 'titleCard.kicker'),
    textSpec('titleCard', 'titleCard.headline', 'titleCard.headline'),
    textSpec('titleCard', 'titleCard.subtitle', 'titleCard.subtitle'),
    colorSpec('titleCard', 'titleCard.accent', 'titleCard.accent'),
    enumSpec('titleCard', 'titleCard.align', 'titleCard.align', 'segmented'),
    colorSpec('titleCard', 'titleCard.background', 'titleCard.background'),
    sliderSpec('titleCard', 'titleCard.stagger', 'titleCard.stagger'),
  ],
  lowerThird: [
    textSpec('lowerThird', 'lowerThird.title', 'lowerThird.title'),
    textSpec('lowerThird', 'lowerThird.subtitle', 'lowerThird.subtitle'),
    textSpec('lowerThird', 'lowerThird.badge', 'lowerThird.badge'),
    colorSpec('lowerThird', 'lowerThird.accent', 'lowerThird.accent'),
    colorSpec('lowerThird', 'lowerThird.bandColor', 'lowerThird.bandColor'),
    sliderSpec('lowerThird', 'lowerThird.boxOpacity', 'lowerThird.band'),
    enumSpec('lowerThird', 'lowerThird.position', 'lowerThird.position', 'segmented'),
  ],
  speed: [speedSpec('speed', 'options.speed', 'video.speed')],
  captureMode: [
    enumSpec('captureMode', 'options.captureMode', 'capture.defaultLabel', 'segmented'),
    enumSpec('captureMode', 'options.allowedCaptureModes', 'capture.allowedLabel', 'chips'),
  ],
  flip: [enumSpec('flip', 'inputs.options.flip', 'animation.mirror', 'segmented')],
  grain: [sliderSpec('grain', 'grade.grain', 'grade.grain')],
  letterbox: [
    sliderSpec('letterbox', 'letterbox.aspect', 'letterbox.aspect'),
    colorSpec('letterbox', 'letterbox.color', 'letterbox.color'),
  ],
  // Motion's shake/pulse fields only exist on their own union member (see `descend`'s bracket
  // notation in schema-walk.ts), so their fieldPaths address the variant explicitly rather than a
  // bare `motion.<key>` (which would resolve nothing — motion.items is a plain union, not an object).
  shake: [
    sliderSpec('shake', 'motion[shake].intensity', 'motion.shakeIntensity'),
    sliderSpec('shake', 'motion[shake].frequency', 'motion.shakeFrequency'),
  ],
  pulse: [
    sliderSpec('pulse', 'motion[pulse].intensity', 'motion.pulseIntensity'),
    sliderSpec('pulse', 'motion[pulse].frequency', 'motion.pulseFrequency'),
  ],
  audioEffect: [enumSpec('audioEffect', 'options.audioEffect', 'audio.effect', 'segmented')],
};
