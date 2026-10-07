// The parameter panel of a library graphic, read off the engine's own schemas: one field per tunable
// parameter of an `fx` primitive (FX_PRIMITIVES) or of a stroke graphic (GraphicSchema), with its
// kind, range and options, so a new parameter in the engine shows up in both builders without a
// hand-written control. Timing, strength, colour and seed are the shared fields every fx takes; the
// target is chosen separately (see fxTargetOptions). Pure, UI-free.

import { z } from 'zod';
import { FX_PRIMITIVES } from 'ffmpeg-video-composer/src/schemas/fx-primitives.schemas.ts';
import { GraphicSchema, type Graphic } from 'ffmpeg-video-composer/src/schemas/graphics.schemas.ts';
import type { FxTarget } from 'ffmpeg-video-composer/src/schemas/fx.schemas.ts';
import type { EditorSection } from './model';
import type { JsonSchemaNode } from './schema-walk';

export type ParamField =
  | { key: string; kind: 'number'; min?: number; max?: number; step: number }
  | { key: string; kind: 'enum'; options: string[] }
  | { key: string; kind: 'boolean' }
  | { key: string; kind: 'color' };

/** Easing choices offered for a library graphic: the built-in motion tokens, then linear. */
export const FX_EASE_OPTIONS = [
  '$smooth',
  '$expo',
  '$juicy',
  '$anticipate',
  '$snappy',
  '$gentle',
  '$bouncy',
  '$wobbly',
  'linear',
] as const;

/** Theme colour tokens a colour field offers next to a custom hex. */
export const FX_COLOR_TOKENS = ['$color.accent', '$color.accent2', '$color.fg', '$color.bg'] as const;

// Fields every library graphic shows in its timing/look block, in display order (absent ones skipped).
const FX_SHARED: ParamField[] = [
  { key: 'at', kind: 'number', min: 0, max: 12, step: 0.05 },
  { key: 'duration', kind: 'number', min: 0.1, max: 12, step: 0.05 },
  { key: 'intensity', kind: 'number', min: 0, max: 1, step: 0.01 },
  { key: 'color', kind: 'color' },
  { key: 'repeat', kind: 'number', min: 1, max: 8, step: 1 },
];

const STROKE_SHARED: ParamField[] = [
  { key: 'at', kind: 'number', min: 0, max: 12, step: 0.05 },
  { key: 'duration', kind: 'number', min: 0.1, max: 3, step: 0.05 },
  { key: 'color', kind: 'color' },
];

// Graphic keys the panel never lists among the own fields: identity, shared timing and the target.
const NOT_OWN = new Set([
  'type',
  'effect',
  'id',
  'at',
  'duration',
  'until',
  'role',
  'above',
  'color',
  'target',
  'ease',
]);

const COLOR_PATTERN_HINT = '\\$color';

function stepFor(min: number | undefined, max: number | undefined, integer: boolean): number {
  if (integer) return 1;

  const span = (max ?? 100) - (min ?? 0);

  if (span <= 1.5) return 0.01;

  if (span <= 20) return 0.1;

  return 1;
}

function fieldOf(key: string, node: JsonSchemaNode & { pattern?: string; exclusiveMinimum?: number }) {
  if (node.enum) return { key, kind: 'enum', options: node.enum.map(String) } as ParamField;

  if (node.type === 'boolean') return { key, kind: 'boolean' } as ParamField;

  if (node.type === 'string' && node.pattern?.includes(COLOR_PATTERN_HINT)) return { key, kind: 'color' } as ParamField;

  if (node.type !== 'number' && node.type !== 'integer') return null;

  const min = node.minimum ?? node.exclusiveMinimum;
  const max = node.maximum;

  return { key, kind: 'number', min, max, step: stepFor(min, max, node.type === 'integer') } as ParamField;
}

function fieldsOf(shape: z.ZodRawShape): ParamField[] {
  const json = z.toJSONSchema(z.object(shape), { unrepresentable: 'any' }) as JsonSchemaNode;

  return Object.entries(json.properties ?? {})
    .filter(([key]) => !NOT_OWN.has(key))
    .map(([key, node]) => fieldOf(key, node))
    .filter((field): field is ParamField => field !== null);
}

function strokeShape(type: string): z.ZodRawShape | undefined {
  const variant = GraphicSchema.options.find(
    (option) => 'shape' in option && (option.shape as { type?: z.ZodLiteral }).type?.value === type
  );

  return variant && 'shape' in variant ? variant.shape : undefined;
}

const OWN_CACHE = new Map<string, ParamField[]>();

/** The graphic's own parameters (an fx primitive's fields, or a stroke graphic's), from the engine schema. */
export function ownParamFields(graphic: Graphic): ParamField[] {
  const key = graphic.type === 'fx' ? `fx:${graphic.effect}` : graphic.type;
  const cached = OWN_CACHE.get(key);

  if (cached) return cached;

  const shape = graphic.type === 'fx' ? FX_PRIMITIVES[graphic.effect].params : strokeShape(graphic.type);
  const fields = shape ? fieldsOf(shape) : [];

  OWN_CACHE.set(key, fields);

  return fields;
}

/** The timing, strength and colour fields the graphic shows above its own parameters. */
export function sharedParamFields(graphic: Graphic): ParamField[] {
  return graphic.type === 'fx' ? FX_SHARED : STROKE_SHARED;
}

/** True for the graphics the parameter panel can edit (fx primitives and the frame/corners/underline strokes). */
export function isTunableGraphic(graphic: Graphic): boolean {
  return (
    graphic.type === 'fx' || graphic.type === 'frame' || graphic.type === 'corners' || graphic.type === 'underline'
  );
}

/** The targets this section offers: the whole frame, then each of its color_background layers. */
export function fxTargetOptions(section: EditorSection): FxTarget[] {
  const layers = section.kind === 'color' ? (section.layers ?? []) : [];

  return ['frame', ...layers.map((_, index) => `layer:${index}` as FxTarget)];
}

/** The graphic with one parameter set (undefined removes it, so the engine's context default applies). */
export function withParam(graphic: Graphic, key: string, value: unknown): Graphic {
  const next: Record<string, unknown> = { ...graphic };

  if (value === undefined) {
    delete next[key];

    return next as Graphic;
  }

  next[key] = value;

  return next as Graphic;
}
