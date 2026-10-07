// Walks authored data against a zod v4 schema to find keys the schema does not declare. A strict
// object already rejects them, but a default (strip) object drops them silently — an LLM that writes
// `"ease"` for `"easing"` gets a template that validates and renders without the easing it asked for.
// Reads zod's public-but-internal `_zod.def` tree; no zod import, so it costs the browser bundle
// nothing beyond this file.

type SchemaDef = { type: string } & Record<string, unknown>;

export type SchemaNode = { _zod: { def: SchemaDef } };

export type DataPath = (string | number)[];

export interface UnknownKey {
  /** Path of the object holding the key. */
  path: DataPath;
  key: string;
  /** Every key the schema allows on that object. */
  allowed: string[];
}

export interface WalkOptions {
  /** Object schemas whose keys are forwarded verbatim (e.g. raw FFmpeg filter values): never flagged. */
  freeForm?: ReadonlySet<unknown>;
}

const WRAPPER_TYPES = new Set(['optional', 'nullable', 'default', 'prefault', 'readonly', 'catch', 'nonoptional']);
const FREE_FORM_TYPES = new Set(['record', 'any', 'unknown', 'custom', 'map']);
const MAX_SCHEMA_DEPTH = 64;

function defOf(node: unknown): SchemaDef {
  return (node as SchemaNode)._zod.def;
}

function isRecordLike(data: unknown): data is Record<string, unknown> {
  return data !== null && typeof data === 'object' && !Array.isArray(data);
}

// Author comments ("$schema", "_note") are never schema keys and never mistakes.
function isCommentKey(key: string): boolean {
  return key.startsWith('$') || key.startsWith('_');
}

function shapeOf(node: SchemaNode): Record<string, SchemaNode> {
  return (defOf(node).shape ?? {}) as Record<string, SchemaNode>;
}

// The literal values an object leaf accepts for `key` (its discriminator), across wrappers/unions.
function literalValues(node: SchemaNode | undefined): unknown[] {
  if (!node) return [];
  const def = defOf(node);

  if (def.type === 'literal') return def.values as unknown[];

  if (def.type === 'enum') return Object.values(def.entries as Record<string, unknown>);

  return WRAPPER_TYPES.has(def.type) ? literalValues(def.innerType as SchemaNode) : [];
}

function acceptsDiscriminator(option: SchemaNode, key: string, value: unknown, depth: number): boolean {
  return leaves(option, undefined, depth + 1).some(
    (leaf) => defOf(leaf).type === 'object' && literalValues(shapeOf(leaf)[key]).includes(value)
  );
}

// A discriminated union keeps only the option the data's discriminator selects (none when it matches
// nothing: zod already reports that); a plain union keeps every option.
function unionOptions(def: SchemaDef, data: unknown, depth: number): SchemaNode[] {
  const options = def.options as SchemaNode[];
  const key = def.discriminator as string | undefined;

  if (!key || !isRecordLike(data)) return options;

  return options.filter((option) => acceptsDiscriminator(option, key, data[key], depth));
}

// The concrete schemas `data` could be checked against: wrappers, lazies, pipes and unions unrolled.
function leaves(node: SchemaNode, data: unknown, depth = 0): SchemaNode[] {
  const def = defOf(node);

  if (depth > MAX_SCHEMA_DEPTH) return [];

  if (WRAPPER_TYPES.has(def.type)) return leaves(def.innerType as SchemaNode, data, depth + 1);

  if (def.type === 'lazy') return leaves((def.getter as () => SchemaNode)(), data, depth + 1);

  if (def.type === 'pipe') return leaves(def.in as SchemaNode, data, depth + 1);

  if (def.type === 'intersection') {
    return [def.left, def.right].flatMap((side) => leaves(side as SchemaNode, data, depth + 1));
  }

  if (def.type === 'union') return unionOptions(def, data, depth).flatMap((option) => leaves(option, data, depth + 1));

  return [node];
}

function isFreeForm(leaf: SchemaNode, options: WalkOptions): boolean {
  const def = defOf(leaf);

  if (FREE_FORM_TYPES.has(def.type) || options.freeForm?.has(leaf)) return true;

  return def.type === 'object' && def.catchall !== undefined && defOf(def.catchall).type !== 'never';
}

function walkArray(nodes: SchemaNode[], data: unknown[], path: DataPath, ctx: WalkContext): void {
  const elements = nodes
    .flatMap((node) => leaves(node, data))
    .filter((leaf) => defOf(leaf).type === 'array')
    .map((leaf) => defOf(leaf).element as SchemaNode);

  if (elements.length === 0) return;

  for (const [index, item] of data.entries()) {
    walk(elements, item, [...path, index], ctx);
  }
}

type WalkContext = { options: WalkOptions; found: UnknownKey[] };

function walkObject(nodes: SchemaNode[], data: Record<string, unknown>, path: DataPath, ctx: WalkContext): void {
  const candidates = nodes.flatMap((node) => leaves(node, data));
  const objects = candidates.filter((leaf) => defOf(leaf).type === 'object');

  if (objects.length === 0 || candidates.some((leaf) => isFreeForm(leaf, ctx.options))) return;

  const allowed = [...new Set(objects.flatMap((leaf) => Object.keys(shapeOf(leaf))))];

  for (const [key, value] of Object.entries(data)) {
    if (isCommentKey(key)) continue;

    if (!allowed.includes(key)) {
      ctx.found.push({ path, key, allowed });
      continue;
    }

    const children = objects.flatMap((leaf) => (key in shapeOf(leaf) ? [shapeOf(leaf)[key]] : []));

    walk(children, value, [...path, key], ctx);
  }
}

function walk(nodes: SchemaNode[], data: unknown, path: DataPath, ctx: WalkContext): void {
  if (Array.isArray(data)) {
    walkArray(nodes, data, path, ctx);

    return;
  }

  if (isRecordLike(data)) walkObject(nodes, data, path, ctx);
}

/** Every key in `data` the schema does not declare, strip and strict objects alike. */
export function findUnknownKeys(schema: unknown, data: unknown, options: WalkOptions = {}): UnknownKey[] {
  const ctx: WalkContext = { options, found: [] };

  walk([schema as SchemaNode], data, [], ctx);

  return ctx.found;
}

/** The keys allowed on the object at `path`, resolved the same way as the walk (for zod's own issues). */
export function allowedKeysAt(found: UnknownKey[], path: string, key: string): string[] | undefined {
  return found.find((entry) => entry.path.join('.') === path && entry.key === key)?.allowed;
}
