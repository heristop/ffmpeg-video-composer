import { z } from 'zod';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonPropsSchema = Record<string, JsonValue>;
export const MAX_SCHEMA_DEPTH = 16;
export const MAX_SCHEMA_NODES = 1024;
export const MAX_NORMALIZED_BYTES = 256 * 1024;
export const MAX_NORMALIZED_NODES = 20000;
interface DefaultCost {
  nodes: number;
  bytes: number;
}
export interface SchemaBudget {
  nodes: number;
  dataNodes: number;
  dataBytes: number;
  defaultCosts: WeakMap<JsonPropsSchema, DefaultCost>;
}
export function createSchemaBudget(dataNodes = 0, dataBytes = 0): SchemaBudget {
  return { nodes: 0, dataNodes, dataBytes, defaultCosts: new WeakMap() };
}
const keywords: Record<string, string[]> = {
  object: ['properties', 'required', 'additionalProperties'],
  string: ['minLength', 'maxLength'],
  number: ['minimum', 'maximum'],
  integer: ['minimum', 'maximum'],
  boolean: [],
  array: ['items', 'minItems', 'maxItems'],
};
const boundKeys: Partial<Record<string, string[]>> = {
  string: ['minLength', 'maxLength'],
  array: ['minItems', 'maxItems'],
  number: ['minimum', 'maximum'],
  integer: ['minimum', 'maximum'],
};
export function catalogError(message: string): never {
  throw new Error(`effect_catalog_invalid: ${message}`);
}
export function assertSafeKey(key: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || key in Object.prototype || key === 'prototype') {
    catalogError(`unsafe property or asset key ${key}.`);
  }
}
function object(value: unknown, location: string): asserts value is Record<string, JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) catalogError(`${location} must be an object.`);
}
function validateKeywords(schema: JsonPropsSchema, location: string): string {
  object(schema, location);

  if (typeof schema.type !== 'string' || !Object.hasOwn(keywords, schema.type)) {
    catalogError(`${location}: unsupported schema type.`);
  }
  const allowed = new Set(['type', 'description', 'default', 'enum', ...keywords[schema.type]]);

  for (const key of Object.keys(schema)) {
    if (!allowed.has(key)) catalogError(`${location}: unsupported keyword ${key}.`);
  }

  if ('description' in schema && typeof schema.description !== 'string') {
    catalogError(`${location}: invalid description.`);
  }

  return schema.type;
}
function validateBounds(schema: JsonPropsSchema, type: string, location: string): void {
  const keys = boundKeys[type];

  if (!keys) return;

  for (const key of keys) {
    if (!(key in schema)) continue;
    const value = schema[key];

    if (typeof value !== 'number' || !Number.isFinite(value)) catalogError(`${location}: invalid ${key}.`);

    if (['string', 'array'].includes(type) && (!Number.isInteger(value) || value < 0)) {
      catalogError(`${location}: invalid ${key}.`);
    }
  }
  const minimum = schema[keys[0]];
  const maximum = schema[keys[1]];

  if (typeof minimum === 'number' && typeof maximum === 'number' && minimum > maximum) {
    catalogError(`${location}: inverted bounds.`);
  }
}
function validateObject(schema: JsonPropsSchema, depth: number, location: string, budget: SchemaBudget): void {
  if (schema.additionalProperties !== false) catalogError(`${location}: objects require additionalProperties:false.`);
  object(schema.properties, `${location}.properties`);
  const properties = schema.properties;

  for (const [key, child] of Object.entries(properties)) {
    assertSafeKey(key);
    object(child, `${location}.${key}`);
    visitSchema(child, depth + 1, `${location}.${key}`, budget);
  }

  if ('required' in schema) {
    if (
      !Array.isArray(schema.required) ||
      schema.required.some((key) => typeof key !== 'string' || !Object.hasOwn(properties, key)) ||
      new Set(schema.required).size !== schema.required.length
    ) {
      catalogError(`${location}: required must name distinct declared properties.`);
    }
  }
}
function validateEnum(schema: JsonPropsSchema, type: string, location: string): void {
  if (!('enum' in schema)) return;

  if (type === 'object' || type === 'array' || !Array.isArray(schema.enum) || schema.enum.length === 0) {
    catalogError(`${location}: enum requires nonempty primitive values.`);
  }
  // The importer handles enum before type/bounds: every literal must satisfy both.
  const { enum: values, default: _default, ...underlying } = schema;
  const validator = z.fromJSONSchema(underlying);

  for (const value of values) {
    if (!validator.safeParse(value).success) catalogError(`${location}: enum value violates its type or bounds.`);
  }

  if (new Set(values.map((value) => JSON.stringify(value))).size !== values.length) {
    catalogError(`${location}: duplicate enum values.`);
  }
}
function addDefaultCost(total: DefaultCost, child: DefaultCost, key?: string): void {
  total.nodes += child.nodes;
  total.bytes += child.bytes;

  if (key !== undefined) total.bytes += Buffer.byteLength(JSON.stringify(key)) + 1;

  if (total.nodes > MAX_NORMALIZED_NODES || total.bytes > MAX_NORMALIZED_BYTES) {
    catalogError('normalized default exceeds JSON data budget.');
  }
}
/** Project default insertion using child summaries; never allocate the expanded value. */
function defaultCost(value: JsonValue, schema: JsonPropsSchema | undefined, budget: SchemaBudget): DefaultCost {
  if (value === null || typeof value !== 'object') {
    return { nodes: 1, bytes: Buffer.byteLength(JSON.stringify(value)) };
  }
  const total = { nodes: 1, bytes: 2 };

  if (Array.isArray(value)) {
    total.bytes += Math.max(0, value.length - 1);
    const items = schema?.type === 'array' ? (schema.items as JsonPropsSchema) : undefined;

    for (const item of value) addDefaultCost(total, defaultCost(item, items, budget));

    return total;
  }

  return objectDefaultCost(value, schema, budget, total);
}
function objectDefaultCost(
  value: Record<string, JsonValue>,
  schema: JsonPropsSchema | undefined,
  budget: SchemaBudget,
  total: DefaultCost
): DefaultCost {
  const properties = schema?.type === 'object' ? (schema.properties as Record<string, JsonPropsSchema>) : {};
  const present = Object.entries(value);
  let fields = present.length;

  for (const [key, item] of present) addDefaultCost(total, defaultCost(item, properties[key], budget), key);

  for (const [key, child] of Object.entries(properties)) {
    if (Object.hasOwn(value, key) || !Object.hasOwn(child, 'default')) continue;
    const cost = budget.defaultCosts.get(child);

    if (!cost) catalogError('normalized default cost was not prepared.');
    addDefaultCost(total, cost, key);
    fields++;
  }
  total.bytes += Math.max(0, fields - 1);

  return total;
}
function normalizeDefault(schema: JsonPropsSchema, location: string, budget: SchemaBudget): void {
  if (!('default' in schema)) return;
  const { default: value, ...underlying } = schema;
  const original = defaultCost(value, undefined, budget);
  const expanded = defaultCost(value, schema, budget);
  const dataNodes = budget.dataNodes + expanded.nodes - original.nodes;
  const dataBytes = budget.dataBytes + expanded.bytes - original.bytes;

  if (dataNodes > MAX_NORMALIZED_NODES || dataBytes > MAX_NORMALIZED_BYTES) {
    catalogError(`${location}: normalized default exceeds catalog JSON data budget.`);
  }
  // Materialize nested defaults only after validating the expansion budget.
  const parsedDefault = z.fromJSONSchema(underlying).safeParse(value);

  if (!parsedDefault.success) catalogError(`${location}: default violates its schema.`);
  schema.default = parsedDefault.data as JsonValue;
  budget.dataNodes = dataNodes;
  budget.dataBytes = dataBytes;
  budget.defaultCosts.set(schema, expanded);
}
function visitSchema(schema: JsonPropsSchema, depth: number, location: string, budget: SchemaBudget): void {
  if (depth > MAX_SCHEMA_DEPTH) catalogError(`${location}: schema depth exceeds ${MAX_SCHEMA_DEPTH}.`);

  if (++budget.nodes > MAX_SCHEMA_NODES) catalogError(`schema node count exceeds ${MAX_SCHEMA_NODES}.`);
  const type = validateKeywords(schema, location);
  validateBounds(schema, type, location);

  if (type === 'object') validateObject(schema, depth, location, budget);

  if (type === 'array') {
    if (typeof schema.maxItems !== 'number' || schema.maxItems > 1000) {
      catalogError(`${location}: arrays require maxItems <= 1000.`);
    }
    object(schema.items, `${location}.items`);
    visitSchema(schema.items, depth + 1, `${location}.items`, budget);
  }
  validateEnum(schema, type, location);

  normalizeDefault(schema, location, budget);
}
/** Bound and reject unsupported keywords before invoking Zod's permissive importer. */
export function compileCustomPropsSchema(
  input: JsonPropsSchema,
  budget = createSchemaBudget()
): z.ZodType<Record<string, unknown>> {
  visitSchema(input, 1, 'propsSchema', budget);

  if (input.type !== 'object') catalogError('propsSchema root must be a strict object.');

  return z.fromJSONSchema(input) as z.ZodType<Record<string, unknown>>;
}
