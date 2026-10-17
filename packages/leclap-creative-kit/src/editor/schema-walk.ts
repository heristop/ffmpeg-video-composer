// Generic zod-JSON-Schema walker primitives shared by every schema-driven consumer: the web docs
// pages (apps/leclap-web/.../doc/schemaFields.ts) and the builder control-metadata registry
// (./control-metadata.ts). Pure — no React/DOM/RN dependency, no knowledge of any particular
// descriptor shape. Callers pass the root JSON schema node explicitly (no module-level schema
// constant here) so this file stays reusable across schemas.

// The JSON Schema is structurally typed (zod's z.toJSONSchema output). We only read a handful of
// keywords, so a narrow shape keeps the walker honest without `any`.
export interface JsonSchemaNode {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  items?: JsonSchemaNode;
  enum?: Array<string | number>;
  const?: string | number | boolean;
  anyOf?: JsonSchemaNode[];
  oneOf?: JsonSchemaNode[];
  minimum?: number;
  maximum?: number;
  default?: unknown;
}

// A single nullable property lookup. Routing every nested access through this keeps the walker
// honest against the schema's optionality.
export function prop(node: JsonSchemaNode | undefined, key: string): JsonSchemaNode | undefined {
  return node?.properties?.[key];
}

// Pull enum values out of a node or its union variants (e.g. transition.type is an anyOf of an enum
// + a "cut" const, so we flatten both).
function variantEnum(node: JsonSchemaNode): Array<string | number> {
  if (node.enum) return node.enum;

  if (node.const !== undefined) return [node.const as string | number];

  return [];
}

export function collectEnum(node: JsonSchemaNode): Array<string | number> {
  if (node.enum) return node.enum;

  const variants = node.anyOf ?? node.oneOf ?? [];

  return variants.flatMap(variantEnum);
}

// Merge a node's union variants (anyOf/oneOf) into a single object so a discriminated union — e.g.
// MotionEffect's kenburns | rotate | crop | flip — can be read as one combined shape. A plain object
// passes through unchanged.
export function mergeVariants(node: JsonSchemaNode | undefined): JsonSchemaNode | undefined {
  const variants = node?.anyOf ?? node?.oneOf;

  if (!node || !variants) return node;

  const merged: Record<string, JsonSchemaNode> = {};

  for (const variant of variants) {
    for (const [key, value] of Object.entries(variant.properties ?? {})) {
      merged[key] ??= value;
    }
  }

  return { type: 'object', properties: merged };
}

// Every member of the descriptor's `sections` discriminated union (video, project_video, form,
// color_background, image_background, music, partial).
export function sectionVariants(schema: JsonSchemaNode): JsonSchemaNode[] {
  return prop(schema, 'sections')?.items?.oneOf ?? [];
}

function variantTypeLiteral(variant: JsonSchemaNode): string | undefined {
  const typeNode = prop(variant, 'type');
  const value = typeNode?.const ?? typeNode?.enum?.[0];

  return typeof value === 'string' ? value : undefined;
}

// The single section variant whose discriminant `type` literal matches (e.g. 'video',
// 'color_background'). Fields defined on `BaseSectionSchema` (chromaKey, lowerThird, …) show up on
// every variant; variant-only fields (titleCard, project_video's captureMode) only resolve here.
export function sectionVariant(schema: JsonSchemaNode, sectionType: string): JsonSchemaNode | undefined {
  return sectionVariants(schema).find((variant) => variantTypeLiteral(variant) === sectionType);
}

// The canonical section variant's own property — every oneOf member shares the same base fields, so
// the first one stands in for "a section" when the caller doesn't care which variant.
export function sectionProperty(schema: JsonSchemaNode, key: string): JsonSchemaNode | undefined {
  return prop(sectionVariants(schema)[0], key);
}

// A property reached through a section variant's `options` sub-object, searched across every
// variant (options differ per section type: `layers` lives on color_background, `framingGuide` on
// project_video).
export function optionProperty(schema: JsonSchemaNode, key: string): JsonSchemaNode | undefined {
  for (const variant of sectionVariants(schema)) {
    const found = prop(prop(variant, 'options'), key);

    if (found) return found;
  }

  return undefined;
}

// A named property read directly off one specific section variant (e.g. titleCard only exists on
// 'color_background').
export function sectionVariantProperty(
  schema: JsonSchemaNode,
  sectionType: string,
  key: string
): JsonSchemaNode | undefined {
  return prop(sectionVariant(schema, sectionType), key);
}

// The raw enum values of a node — flattening a union the same way `collectEnum` does — or, for an
// array-typed node (e.g. `allowedCaptureModes: CaptureMode[]`), the enum of its item type. `null`
// when the node carries no enum at all, so callers can tell "no constraint" apart from "empty".
export function enumOf(node: JsonSchemaNode | undefined): readonly string[] | null {
  if (!node) return null;

  const target = node.type === 'array' && node.items ? node.items : node;
  const values = collectEnum(target);

  return values.length > 0 ? values.map((value) => String(value)) : null;
}

// The raw numeric range (and default, when the zod schema declares one via `.default()`) of a
// number node. Fields only documented as "default N" in `.describe()` text (no `.default()` call)
// come back with `default: undefined` — the registry must not invent a value the schema doesn't
// actually encode.
export function rangeOf(node: JsonSchemaNode | undefined): { min?: number; max?: number; default?: unknown } {
  return { min: node?.minimum, max: node?.maximum, default: node?.default };
}

// A path segment addressing one member of an array-of-discriminated-union field by its `type`
// literal — e.g. "motion[shake]" picks the shake variant out of section.motion's kenburns | rotate |
// crop | flip | shake | pulse union. Needed because a plain segment (see `descend` below) only
// unwraps a *plain* array; a discriminated union has no single `.properties` to read a key off, so
// callers addressing a field that only exists on one variant (motion shake/pulse's intensity/frequency
// ranges differ per type) must name the variant explicitly.
const UNION_MEMBER_SEGMENT = /^([a-zA-Z0-9_]+)\[([a-zA-Z0-9_-]+)\]$/;

function unionMemberLiteral(variant: JsonSchemaNode): string | undefined {
  const typeNode = prop(variant, 'type');
  const value = typeNode?.const ?? typeNode?.enum?.[0];

  return typeof value === 'string' ? value : undefined;
}

function unionMemberNode(
  node: JsonSchemaNode | undefined,
  key: string,
  discriminant: string
): JsonSchemaNode | undefined {
  const field = prop(node, key);
  const items = field?.type === 'array' && field.items ? field.items : field;
  const variants = items?.oneOf ?? items?.anyOf ?? [];

  return variants.find((variant) => unionMemberLiteral(variant) === discriminant);
}

// Unwrap one path segment: arrays forward to their `items` before the property lookup, so a fixed
// segment convention like "inputs.options.flip" reads through the array without a special case per
// caller. A bracketed segment ("motion[shake]") instead selects one union member by its `type`
// literal, returning that variant's own node so the next segment can read a variant-only field.
function descend(node: JsonSchemaNode | undefined, segment: string): JsonSchemaNode | undefined {
  const unionMember = UNION_MEMBER_SEGMENT.exec(segment);

  if (unionMember) {
    const [, key, discriminant] = unionMember;

    return unionMemberNode(node, key, discriminant);
  }

  const unwrapped = node?.type === 'array' && node.items ? node.items : node;

  return prop(unwrapped, segment);
}

// Independently re-resolves a control-metadata `fieldPath` against the live schema: tries every
// section variant as the root and descends the dot-path segments, returning the first variant that
// resolves it fully. This is deliberately schema-driven rather than a hardcoded
// feature→section-type table — chromaKey/lowerThird live on every variant, titleCard only on
// color_background, captureMode only on project_video, and the search finds each without knowing
// that ahead of time. `feature` is carried through purely for caller-side error messages (e.g. the
// conformance test's assertion label); it does not steer the search.
//
// Takes `schema` as `unknown` (rather than `JsonSchemaNode`) so callers can pass zod's
// `z.toJSONSchema()` output — a structurally different but compatible type — straight through
// without a cast, matching how the conformance test calls this.
export function resolveFieldPath(schema: unknown, _feature: string, fieldPath: string): JsonSchemaNode | undefined {
  const root = schema as JsonSchemaNode;
  const segments = fieldPath.split('.');

  for (const variant of sectionVariants(root)) {
    let node: JsonSchemaNode | undefined = variant;

    for (const segment of segments) {
      if (!node) break;

      node = descend(node, segment);
    }

    if (node) return node;
  }

  return undefined;
}
