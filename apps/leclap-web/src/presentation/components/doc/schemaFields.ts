// Pure transforms that turn the engine's exported JSON Schema into readable field
// rows. Keeping these out of the React tree makes them unit-testable and keeps the
// docs page in lock-step with the schema (no hand-maintained field lists). The generic
// walker primitives (JsonSchemaNode, prop, collectEnum, mergeVariants, sectionVariants,
// sectionProperty, optionProperty) live in creative-kit, shared with the builder's
// control-metadata registry; only the docs-page-specific formatting stays here.
import { templateDescriptorJsonSchema } from 'ffmpeg-video-composer/src/schemas/template.schemas.ts';
import {
  type JsonSchemaNode,
  prop,
  collectEnum,
  mergeVariants,
  sectionVariants as sharedSectionVariants,
  sectionProperty as sharedSectionProperty,
  optionProperty as sharedOptionProperty,
} from '@leclap/creative-kit/editor';

export type { JsonSchemaNode };

export interface FieldRow {
  name: string;
  type: string;
  /** enum values / numeric range / default, pre-formatted for a "Constraints" cell. */
  constraints: string;
  description: string;
  required: boolean;
}

const schema = templateDescriptorJsonSchema as unknown as JsonSchemaNode;

// A compact, human type label for one node: collapses anyOf/oneOf unions, names
// arrays by their item type, and surfaces a literal const.
export function typeLabel(node: JsonSchemaNode): string {
  if (node.const !== undefined) return JSON.stringify(node.const);

  if (node.anyOf || node.oneOf) {
    const variants = node.anyOf ?? node.oneOf ?? [];
    const labels = variants.map(typeLabel);

    return [...new Set(labels)].join(' | ');
  }

  if (node.type === 'array') {
    const inner = node.items ? typeLabel(node.items) : 'unknown';

    return `${inner}[]`;
  }

  if (Array.isArray(node.type)) return node.type.join(' | ');

  return node.type ?? 'object';
}

// enum list (truncated), numeric range, and default — joined into one cell string.
export function constraintsLabel(node: JsonSchemaNode): string {
  const parts: string[] = [];
  const values = collectEnum(node);

  if (values.length > 0) {
    const shown = values.slice(0, 6).join(', ');
    parts.push(values.length > 6 ? `${shown}, …` : shown);
  }

  if (node.minimum !== undefined || node.maximum !== undefined) {
    const lo = node.minimum ?? '−∞';
    const hi = node.maximum ?? '∞';
    parts.push(`${lo}…${hi}`);
  }

  if (node.default !== undefined) parts.push(`default ${JSON.stringify(node.default)}`);

  return parts.join(' · ');
}

// Turn an object node's `properties` into ordered, readable field rows.
export function fieldRows(node: JsonSchemaNode | undefined): FieldRow[] {
  if (!node?.properties) return [];

  const required = new Set(node.required ?? []);

  return Object.entries(node.properties).map(([name, prop]) => ({
    name,
    type: typeLabel(prop),
    constraints: constraintsLabel(prop),
    description: prop.description ?? '',
    required: required.has(name),
  }));
}

// Thin bindings of the shared walker primitives to this module's schema, so the rest of the file
// reads exactly as it did before extraction.
const sectionVariants = (): JsonSchemaNode[] => sharedSectionVariants(schema);
const sectionProperty = (key: string): JsonSchemaNode | undefined => sharedSectionProperty(schema, key);
const optionProperty = (key: string): JsonSchemaNode | undefined => sharedOptionProperty(schema, key);

// Union the `options` properties across every section type so the docs show the full
// surface (e.g. `layers` lives on color_background, `framingGuide` on project_video).
function unionOptions(): JsonSchemaNode {
  const merged: Record<string, JsonSchemaNode> = {};

  for (const variant of sectionVariants()) {
    const options = prop(variant, 'options')?.properties ?? {};

    for (const [key, value] of Object.entries(options)) {
      merged[key] ??= value;
    }
  }

  return { type: 'object', properties: merged };
}

// ── Granular accessors for the multi-page docs ──────────────────────────────────
// Each returns the field rows for one schema node, so a topic page renders exactly its slice while
// staying schema-driven (add a field in the engine's zod schema and it surfaces here).

const audioNode = (): JsonSchemaNode | undefined => prop(schema.properties?.global, 'audio');

export const docGroups = {
  meta: (): FieldRow[] => fieldRows(prop(schema, 'meta')),
  global: (): FieldRow[] => fieldRows(schema.properties?.global),
  globalAudio: (): FieldRow[] => fieldRows(audioNode()),
  ducking: (): FieldRow[] => fieldRows(mergeVariants(prop(audioNode(), 'ducking'))),
  section: (): FieldRow[] => fieldRows(sectionVariants()[0]),
  options: (): FieldRow[] => fieldRows(unionOptions()),
  inputs: (): FieldRow[] => fieldRows(sectionProperty('inputs')?.items),
  inputOptions: (): FieldRow[] => fieldRows(prop(sectionProperty('inputs')?.items, 'options')),
  transition: (): FieldRow[] => fieldRows(sectionProperty('transition')),
  grade: (): FieldRow[] => fieldRows(sectionProperty('grade')),
  motion: (): FieldRow[] => fieldRows(mergeVariants(sectionProperty('motion')?.items)),
  motionVariants: (): { name: string; rows: FieldRow[] }[] => {
    const node = sectionProperty('motion')?.items;

    return (node?.anyOf ?? node?.oneOf ?? []).map((variant) => ({
      name: String(prop(variant, 'type')?.const),
      rows: fieldRows(variant),
    }));
  },
  titleCard: (): FieldRow[] => fieldRows(sectionProperty('titleCard')),
  lowerThird: (): FieldRow[] => fieldRows(sectionProperty('lowerThird')),
  reveal: (): FieldRow[] => fieldRows(mergeVariants(prop(sectionProperty('caption'), 'reveal'))),
  textEffect: (): FieldRow[] => fieldRows(prop(sectionProperty('caption'), 'effect')),
  framingGuide: (): FieldRow[] => fieldRows(optionProperty('framingGuide')),
  layers: (): FieldRow[] => fieldRows(optionProperty('layers')?.items),
  caption: (): FieldRow[] => fieldRows(sectionProperty('caption')),
  filters: (): FieldRow[] => fieldRows(sectionProperty('filters')?.items),
  filterValues: (): FieldRow[] => fieldRows(prop(sectionProperty('filters')?.items, 'values')),
  maps: (): FieldRow[] => fieldRows(sectionProperty('maps')?.items),
  audioFade: (): FieldRow[] => fieldRows(prop(optionProperty('audioFade'), 'in')),
};

// Every section `type` literal from the discriminated union, schema-driven so the set stays current.
export function sectionTypeValues(): string[] {
  return sectionVariants()
    .map((variant) => {
      const typeNode = prop(variant, 'type');
      const value = typeNode?.const ?? typeNode?.enum?.[0];

      return typeof value === 'string' ? value : '';
    })
    .filter((value) => value !== '');
}
