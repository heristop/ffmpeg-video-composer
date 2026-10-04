import fs from 'node:fs';
import { z } from 'zod';
import { EffectReferenceSchema } from 'ffmpeg-video-composer';
import type { EffectDefinition } from './effect-catalog.js';
import { TITLE_EFFECT_ID, TITLE_COMPOSITION_ID } from './title-definition.js';
import { PROMO_EFFECT_ID, PROMO_COMPOSITION_ID } from './promo-registry.js';
import { templateRevision } from './template-revision.js';
import {
  assertSafeKey,
  catalogError,
  compileCustomPropsSchema,
  createSchemaBudget,
  type SchemaBudget,
  type JsonPropsSchema,
} from './custom-props-schema.js';

export const EFFECT_OUTPUT = {
  width: 1280,
  height: 720,
  fps: 30,
  durationInFrames: 300,
  durationSeconds: 10,
  orientation: 'landscape',
} as const;

export const MAX_CATALOG_BYTES = 256 * 1024;
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'] as const;
export const FONT_EXTENSIONS = ['.ttf', '.otf', '.woff', '.woff2'] as const;
export const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm', '.m4v'] as const;
const extensions = [...IMAGE_EXTENSIONS, ...FONT_EXTENSIONS, ...VIDEO_EXTENSIONS];
export interface JsonAssetDeclaration {
  readonly extensions: readonly string[];
  readonly required: boolean;
  readonly minVideoDurationSeconds?: number;
}
export interface JsonEffectDefinition {
  readonly id: string;
  readonly version: string;
  readonly compositionId: string;
  readonly description?: string;
  readonly propsSchema: JsonPropsSchema;
  readonly assets: Readonly<Record<string, JsonAssetDeclaration>>;
}
export interface JsonEffectCatalog {
  readonly schemaVersion: 1;
  readonly effects: readonly JsonEffectDefinition[];
}
const cachedDefinitions = new WeakMap<JsonEffectCatalog, readonly EffectDefinition[]>();
const assetSchema = z
  .object({
    extensions: z.array(z.enum(extensions)).min(1).max(extensions.length),
    required: z.boolean().default(true),
    minVideoDurationSeconds: z.number().positive().optional(),
  })
  .strict();
const catalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    effects: z
      .array(
        z
          .object({
            id: EffectReferenceSchema.shape.id,
            version: EffectReferenceSchema.shape.version,
            compositionId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/),
            description: z.string().optional(),
            propsSchema: z.unknown(),
            assets: z.record(z.string(), assetSchema),
          })
          .strict()
      )
      .max(64),
  })
  .strict();

interface JsonBudget {
  nodes: number;
  bytes: number;
  active: WeakSet<object>;
}
function primitiveJson(value: unknown, budget: JsonBudget): boolean {
  if (value === null || typeof value === 'boolean') return true;

  if (typeof value === 'number' && Number.isFinite(value)) return true;

  if (typeof value !== 'string') return false;
  budget.bytes += Buffer.byteLength(value);

  if (budget.bytes > MAX_CATALOG_BYTES) catalogError('catalog exceeds 256 KiB.');

  return true;
}
function jsonFields(value: object): [string, unknown][] {
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    catalogError('catalog must contain plain JSON objects.');
  }
  const fields: [string, unknown][] = [];

  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);

    if (typeof key !== 'string' || !descriptor?.enumerable || !('value' in descriptor)) {
      catalogError('catalog must contain plain JSON fields.');
    }

    if (key in Object.prototype || key === 'prototype') catalogError(`unsafe JSON key ${key}.`);
    fields.push([key, descriptor.value]);
  }

  return fields;
}
function visitJson(value: unknown, depth: number, budget: JsonBudget): void {
  if (depth > 64 || ++budget.nodes > 20000) catalogError('JSON depth or node budget exceeded.');

  if (primitiveJson(value, budget)) return;

  if (typeof value !== 'object' || value === null) catalogError('catalog must contain finite JSON data only.');

  if (budget.active.has(value)) catalogError('catalog contains cyclic JSON.');
  budget.active.add(value);

  for (const [key, child] of jsonFields(value)) {
    budget.bytes += Buffer.byteLength(key);
    visitJson(child, depth + 1, budget);
  }
  budget.active.delete(value);
}
function jsonSnapshot(input: unknown) {
  const usage = { nodes: 0, bytes: 0, active: new WeakSet<object>() };
  visitJson(input, 0, usage);
  const json = JSON.stringify(input);

  if (Buffer.byteLength(json) > MAX_CATALOG_BYTES) catalogError('catalog exceeds 256 KiB.');

  return { value: JSON.parse(json), nodes: usage.nodes, bytes: Buffer.byteLength(json) };
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }

  return value;
}

function compileAssets(effect: JsonEffectDefinition) {
  const shape: Record<string, z.ZodType> = {};
  const assetExtensions: Record<string, readonly string[]> = {};
  const assetVideoPolicies: EffectDefinition['assetVideoPolicies'] = {};

  for (const [key, policy] of Object.entries(effect.assets)) {
    assertSafeKey(key);

    if (Object.hasOwn(effect.propsSchema.properties as object, key)) catalogError(`asset ${key} collides with a prop.`);

    if (new Set(policy.extensions).size !== policy.extensions.length) {
      catalogError(`asset ${key}: duplicate extensions.`);
    }

    if (policy.minVideoDurationSeconds !== undefined) {
      if (!policy.extensions.every((ext) => (VIDEO_EXTENSIONS as readonly string[]).includes(ext))) {
        catalogError(`asset ${key}: minimum video duration requires video-only extensions.`);
      }
      assetVideoPolicies[key] = { minVideoDurationSeconds: policy.minVideoDurationSeconds };
    }
    shape[key] = policy.required ? z.string().min(1) : z.string().min(1).optional();
    assetExtensions[key] = policy.extensions;
  }

  return { assets: z.object(shape).strict() as z.ZodType<Record<string, string>>, assetExtensions, assetVideoPolicies };
}
function compileDefinition(effect: JsonEffectDefinition, budget: SchemaBudget): EffectDefinition {
  const props = compileCustomPropsSchema(effect.propsSchema, budget);

  return {
    id: effect.id,
    version: effect.version,
    compositionId: effect.compositionId,
    description: effect.description,
    props,
    ...compileAssets(effect),
    output: EFFECT_OUTPUT,
    timing: 'Custom timing controls follow the declared props schema.',
    assetRestrictions:
      'Regular local files within mediaDir, realpath-contained. Extra props/assets rejected. Video duration policies are explicit.',
    definitionHash: templateRevision({ ...effect, output: EFFECT_OUTPUT }),
  };
}

export function parseCustomEffectCatalog(input: unknown): JsonEffectCatalog {
  try {
    const parsed = catalogSchema.parse(jsonSnapshot(input).value);
    const usage = jsonSnapshot(parsed);
    const identities = new Set<string>();
    const budget = createSchemaBudget(usage.nodes, usage.bytes);
    const compiled: EffectDefinition[] = [];

    for (const effect of parsed.effects) {
      const identity = `${effect.id}@${effect.version}`;

      if (identities.has(identity)) catalogError(`duplicate effect ${identity}.`);
      identities.add(identity);

      if (
        [TITLE_EFFECT_ID, PROMO_EFFECT_ID].includes(effect.id) ||
        [TITLE_COMPOSITION_ID, PROMO_COMPOSITION_ID].includes(effect.compositionId)
      ) {
        catalogError(`${identity}: builtin identities and compositions cannot be overridden.`);
      }
      compiled.push(compileDefinition(effect as JsonEffectDefinition, budget));
    }
    const catalog = freeze(parsed) as JsonEffectCatalog;
    cachedDefinitions.set(catalog, freeze(compiled));

    return catalog;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('effect_catalog_invalid:')) throw error;

    return catalogError(error instanceof Error ? error.message : String(error));
  }
}
/** Compiled validators belong to a validated immutable snapshot, never to the serialized catalog. */
export function getCustomEffectDefinitions(catalog: JsonEffectCatalog): readonly EffectDefinition[] {
  const definitions = cachedDefinitions.get(catalog);

  if (!definitions) catalogError('catalog must be a parsed immutable snapshot.');

  return definitions;
}

export function loadCustomEffectCatalog(file: string): JsonEffectCatalog {
  let fd: number | undefined;

  try {
    // O_NONBLOCK prevents FIFO open from hanging before the regular-file check.
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    const stat = fs.fstatSync(fd);

    if (!stat.isFile()) catalogError('catalog must be a regular file.');

    if (stat.size > MAX_CATALOG_BYTES) catalogError('catalog exceeds 256 KiB.');
    // The extra byte detects growth after fstat without ever reading an unbounded file.
    const buffer = Buffer.alloc(MAX_CATALOG_BYTES + 1);
    let length = 0;

    while (length < buffer.length) {
      const read = fs.readSync(fd, buffer, length, buffer.length - length, null);

      if (!read) break;
      length += read;
    }

    if (length > MAX_CATALOG_BYTES) catalogError('catalog exceeds 256 KiB.');
    let json: unknown;

    try {
      json = JSON.parse(buffer.subarray(0, length).toString('utf8'));
    } catch {
      catalogError('catalog is not valid JSON.');
    }

    return parseCustomEffectCatalog(json);
  } catch (error) {
    return catalogError(
      `${file}: ${error instanceof Error ? error.message.replace(/^effect_catalog_invalid: /, '') : String(error)}`
    );
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
