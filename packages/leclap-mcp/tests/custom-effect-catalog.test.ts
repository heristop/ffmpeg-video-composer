import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { getEffectDefinition, listEffectDefinitions } from '../src/effects/effect-catalog.js';
import { loadCustomEffectCatalog, parseCustomEffectCatalog } from '../src/effects/custom-effect-catalog.js';

const product = {
  id: 'studio.product',
  version: '1.0.0',
  compositionId: 'Product',
  description: 'A product reveal',
  propsSchema: {
    type: 'object',
    properties: { headline: { type: 'string', minLength: 1, maxLength: 80, default: 'Product' } },
    additionalProperties: false,
  },
  assets: {},
};
const document = (effect: Record<string, unknown> = product) => ({ schemaVersion: 1, effects: [effect] });
const lookup = (input: unknown = document()) => {
  const catalog = parseCustomEffectCatalog(input);
  return getEffectDefinition('studio.product', '1.0.0', catalog);
};
const withProp = (schema: unknown) =>
  document({
    ...product,
    propsSchema: { type: 'object', properties: { control: schema }, additionalProperties: false },
  });
function nestedDefault(levels: number, width: number, leaf: string): Record<string, unknown> {
  let schema: Record<string, unknown> = { type: 'string', default: leaf };
  for (let level = 0; level < levels; level++) {
    schema = {
      type: 'array',
      maxItems: width,
      default: Array.from({ length: width }, () => ({})),
      items: { type: 'object', additionalProperties: false, properties: { child: schema } },
    };
  }
  return schema;
}
const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('custom effect catalog', () => {
  it('resolves operator compositions and applies bounded prop defaults', () => {
    const definition = lookup();
    expect(definition.compositionId).toBe('Product');
    expect(definition.props.parse({})).toEqual({ headline: 'Product' });
    expect(definition.props.safeParse({ headline: '' }).success).toBe(false);
    expect(definition.props.safeParse({ headline: 'x'.repeat(81) }).success).toBe(false);
    expect(definition.props.safeParse({ source: 'return 1' }).success).toBe(false);
    expect(definition.assets.parse({})).toEqual({});
    expect(definition.assets.safeParse({ source: '/entry.tsx' }).success).toBe(false);
  });
  it('enforces nested strict objects, required values, enums, arrays and inclusive numeric bounds', () => {
    const definition = lookup(
      withProp({
        type: 'object',
        additionalProperties: false,
        required: ['name', 'controls'],
        properties: {
          name: { type: 'string', minLength: 1 },
          controls: {
            type: 'array',
            minItems: 1,
            maxItems: 2,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['count', 'enabled', 'tone'],
              properties: {
                count: { type: 'integer', minimum: 0, maximum: 2 },
                enabled: { type: 'boolean' },
                tone: { type: 'string', enum: ['soft', 'bright'] },
                amount: { type: 'number', minimum: 0, maximum: 1 },
              },
            },
          },
        },
      })
    );
    const valid = { control: { name: 'x', controls: [{ count: 2, enabled: true, tone: 'soft', amount: 1 }] } };
    expect(definition.props.parse(valid)).toEqual(valid);
    for (const control of [
      { controls: [] },
      { ...valid.control, extra: true },
      { ...valid.control, controls: [{ ...valid.control.controls[0], extra: true }] },
      { ...valid.control, controls: [{ ...valid.control.controls[0], count: 1.5 }] },
      { ...valid.control, controls: [{ ...valid.control.controls[0], count: 3 }] },
      { ...valid.control, controls: [{ ...valid.control.controls[0], amount: Infinity }] },
      { ...valid.control, controls: [{ ...valid.control.controls[0], tone: 'other' }] },
      { ...valid.control, controls: Array(3).fill(valid.control.controls[0]) },
    ]) {
      expect(definition.props.safeParse({ control }).success).toBe(false);
    }
  });
  it('requires a property without a default but fills optional defaults', () => {
    const definition = lookup(
      document({
        ...product,
        propsSchema: {
          ...product.propsSchema,
          required: ['name'],
          properties: {
            ...product.propsSchema.properties,
            name: { type: 'string', minLength: 1 },
          },
        },
      })
    );
    expect(definition.props.safeParse({}).success).toBe(false);
    expect(definition.props.parse({ name: 'Shop' })).toEqual({ name: 'Shop', headline: 'Product' });
  });
  it('fills nested defaults inside object and array defaults before Zod can short circuit them', () => {
    const definition = lookup(
      withProp({
        type: 'array',
        maxItems: 2,
        default: [{}],
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name'],
          properties: { name: { type: 'string', minLength: 1, default: 'Nested' } },
        },
      })
    );
    expect(definition.props.parse({})).toEqual({ control: [{ name: 'Nested' }] });
  });
  it.each([
    [4, 20, 'x'.repeat(10)],
    [1, 3, 'x'.repeat(100000)],
  ])('rejects normalized default expansion before materializing it (%i levels, %i items)', (levels, width, leaf) => {
    const input = withProp(nestedDefault(levels as number, width as number, leaf as string));
    expect(Buffer.byteLength(JSON.stringify(input))).toBeLessThan(256 * 1024);
    expect(() => parseCustomEffectCatalog(input)).toThrow(/effect_catalog_invalid.*normalized default.*budget/);
  });
  it.each([
    [1, 3, 'x'.repeat(40000), 2],
    [3, 15, '', 3],
  ])('bounds normalized defaults across effects (%i levels, %i items)', (levels, width, leaf, count) => {
    const effect = withProp(nestedDefault(levels as number, width as number, leaf as string)).effects[0];
    expect(() => parseCustomEffectCatalog(document(effect))).not.toThrow();
    const effects = Array.from({ length: count as number }, (_, index) => ({
      ...effect,
      id: `studio.product${index}`,
    }));
    expect(() => parseCustomEffectCatalog({ schemaVersion: 1, effects })).toThrow(
      /effect_catalog_invalid.*normalized default.*budget/
    );
  });
  it('keeps legitimate nested array defaults within the aggregate data budget', () => {
    expect(lookup(withProp(nestedDefault(2, 2, 'ok'))).props.parse({})).toEqual({
      control: [{ child: [{ child: 'ok' }, { child: 'ok' }] }, { child: [{ child: 'ok' }, { child: 'ok' }] }],
    });
  });
  it('normalizes and freezes JSON snapshots without retaining mutable caller input', () => {
    const input = document({ ...product, assets: { photo: { extensions: ['.png'] } } });
    const catalog = parseCustomEffectCatalog(input);
    const serialized = JSON.stringify(catalog);
    expect(JSON.parse(serialized).effects[0].assets.photo.required).toBe(true);
    expect(Object.isFrozen(catalog.effects[0].propsSchema.properties)).toBe(true);
    input.effects[0].compositionId = 'Changed';
    expect(getEffectDefinition('studio.product', '1.0.0', catalog).compositionId).toBe('Product');
    expect(() => Object.assign(catalog.effects[0], { compositionId: 'Changed' })).toThrow();
    expect(getEffectDefinition('studio.product', '1.0.0', catalog)).toBe(
      getEffectDefinition('studio.product', '1.0.0', catalog)
    );
  });
  it('discovers builtins plus custom definitions and keeps builtin refinements', () => {
    const catalog = parseCustomEffectCatalog(document());
    expect(listEffectDefinitions(catalog).map((entry) => entry.id)).toEqual([
      'leclap.title-reveal',
      'leclap.web-app-promo',
      'studio.product',
    ]);
    const title = getEffectDefinition('leclap.title-reveal', '1.0.0');
    expect(title.props.parse({ headline: '  Hi  ' }).headline).toBe('Hi');
    expect(title.props.safeParse({ logoDelayFrames: 299, entranceDurationFrames: 2 }).success).toBe(false);
    expect(title.assetVideoPolicies).toEqual({ background: { minVideoDurationSeconds: 10 } });
    expect(() => getEffectDefinition('missing', '1.0.0', catalog)).toThrow(/studio.product/);
  });
  it('hashes canonical normalized contracts and changes identity when mapping or policies change', () => {
    const first = lookup();
    expect(
      lookup(
        document({
          assets: {},
          propsSchema: product.propsSchema,
          description: product.description,
          compositionId: 'Product',
          version: '1.0.0',
          id: 'studio.product',
        })
      ).definitionHash
    ).toBe(first.definitionHash);
    expect(lookup(document({ ...product, compositionId: 'ProductTwo' })).definitionHash).not.toBe(first.definitionHash);
    expect(lookup(withProp({ type: 'string', maxLength: 1 })).definitionHash).not.toBe(first.definitionHash);
    const omitted = lookup(document({ ...product, assets: { photo: { extensions: ['.png'] } } }));
    const explicit = lookup(document({ ...product, assets: { photo: { extensions: ['.png'], required: true } } }));
    expect(omitted.definitionHash).toBe(explicit.definitionHash);
    expect(getEffectDefinition('leclap.title-reveal', '1.0.0').definitionHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('generates required and optional strict asset contracts with explicit video policy', () => {
    const definition = lookup(
      document({
        ...product,
        assets: {
          clip: { extensions: ['.mov', '.mp4'], minVideoDurationSeconds: 3 },
          background: { extensions: ['.mp4'], required: false },
          font: { extensions: ['.woff2'], required: false },
        },
      })
    );
    expect(definition.assets.parse({ clip: 'clip.mp4' })).toEqual({ clip: 'clip.mp4' });
    expect(definition.assets.safeParse({}).success).toBe(false);
    expect(definition.assets.safeParse({ clip: '' }).success).toBe(false);
    expect(definition.assetVideoPolicies).toEqual({ clip: { minVideoDurationSeconds: 3 } });
    expect(definition.assetExtensions.clip).toEqual(['.mov', '.mp4']);
  });
  it.each([
    null,
    [],
    {},
    { schemaVersion: 2, effects: [] },
    { schemaVersion: 1, effects: [], code: 'x' },
    document({ ...product, source: 'root.tsx' }),
    document({ ...product, output: { width: 100 } }),
    document({ ...product, compositionId: '../Root' }),
    document({ ...product, id: 'invalid id' }),
    document({ ...product, version: '^1.0.0' }),
    document({ ...product, version: '01.0.0' }),
    { schemaVersion: 1, effects: [product, product] },
    document({ ...product, id: 'leclap.title-reveal', version: '2.0.0' }),
    document({ ...product, compositionId: 'LeclapTitle' }),
    document({ ...product, id: 'leclap.web-app-promo' }),
    { schemaVersion: 1, effects: Array.from({ length: 65 }, (_, n) => ({ ...product, id: `custom.${n}` })) },
  ])('rejects malformed, duplicate, executable or builtin-overriding catalog %j', (input) => {
    expect(() => parseCustomEffectCatalog(input)).toThrow(/effect_catalog_invalid/);
  });
  it('accepts ASCII Remotion composition IDs and rejects unsupported underscores', () => {
    expect(lookup(document({ ...product, compositionId: 'Product-2' })).compositionId).toBe('Product-2');
    expect(() => lookup(document({ ...product, compositionId: 'Product_2' }))).toThrow(/effect_catalog_invalid/);
  });
  it('accepts exact prerelease/build semver and slash namespaces supported by template effects', () => {
    const catalog = parseCustomEffectCatalog(
      document({ ...product, id: 'studio/product', version: '1.2.3-beta.1+build.1' })
    );
    expect(getEffectDefinition('studio/product', '1.2.3-beta.1+build.1', catalog).compositionId).toBe('Product');
  });
  it.each([
    { type: 'string', format: 'uri' },
    { type: 'string', pattern: '.*' },
    { type: 'string', unknown: 1 },
    { type: ['string', 'number'] },
    { type: 'null' },
    {},
    true,
    { $ref: '#/definitions/x' },
    { type: 'string', anyOf: [] },
    { type: 'string', allOf: [] },
    { type: 'string', if: {} },
    { type: 'string', contentEncoding: 'base64' },
    { type: 'object', properties: {} },
    { type: 'object', properties: {}, additionalProperties: true },
    { type: 'object', properties: {}, additionalProperties: false, required: ['absent'] },
    { type: 'object', properties: {}, additionalProperties: false, required: ['x', 'x'] },
    { type: 'array', items: { type: 'string' } },
    { type: 'array', items: [{ type: 'string' }], maxItems: 2 },
    { type: 'array', items: { type: 'string' }, maxItems: 1001 },
    { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 2 },
    { type: 'string', minLength: 2, maxLength: 1 },
    { type: 'string', minLength: -1 },
    { type: 'number', minimum: Infinity },
    { type: 'number', minimum: 2, maximum: 1 },
    { type: 'boolean', minimum: 0 },
    { type: 'string', description: 2 },
    { type: 'string', minLength: 1, default: '' },
    { type: 'integer', minimum: 1, default: 0 },
    { type: 'integer', default: 1.5 },
    { type: 'boolean', default: 'yes' },
    { type: 'string', enum: ['x'], default: 'y' },
    { type: 'string', enum: [] },
    { type: 'string', minLength: 2, enum: ['x'] },
    { type: 'integer', maximum: 1, enum: [2] },
    { type: 'boolean', enum: [1] },
    { type: 'object', properties: {}, additionalProperties: false, default: { injected: true } },
  ])('fails closed on unsupported schema or invalid defaults %j', (schema) => {
    expect(() => parseCustomEffectCatalog(withProp(schema))).toThrow(/effect_catalog_invalid/);
  });
  it.each(['__proto__', 'prototype', 'constructor', 'toString', '../escape', 'bad-name', 'bad.name'])(
    'rejects unsafe property and asset key %s',
    (key) => {
      const properties = JSON.parse(`{"${key}":{"type":"string"}}`);
      expect(() =>
        parseCustomEffectCatalog(
          document({
            ...product,
            propsSchema: {
              type: 'object',
              properties,
              additionalProperties: false,
            },
          })
        )
      ).toThrow(/effect_catalog_invalid/);
      expect(() =>
        parseCustomEffectCatalog(
          document({ ...product, assets: Object.fromEntries([[key, { extensions: ['.png'] }]]) })
        )
      ).toThrow(/effect_catalog_invalid/);
    }
  );
  it.each([
    { headline: { extensions: ['.png'] } },
    { photo: { extensions: ['.tsx'] } },
    { photo: { extensions: [] } },
    { photo: { extensions: ['.PNG'] } },
    { photo: { extensions: ['.png', '.png'] } },
    { photo: { extensions: ['.png'], required: 'yes' } },
    { photo: { extensions: ['.png'], minVideoDurationSeconds: 1 } },
    { clip: { extensions: ['.mp4', '.png'], minVideoDurationSeconds: 1 } },
    { clip: { extensions: ['.mp4'], minVideoDurationSeconds: 0 } },
    { clip: { extensions: ['.mp4'], minVideoDurationSeconds: Infinity } },
    { clip: { extensions: ['.mp4'], source: 'x' } },
  ])('rejects unsafe or inconsistent asset policy %j', (assets) => {
    expect(() => parseCustomEffectCatalog(document({ ...product, assets }))).toThrow(/effect_catalog_invalid/);
  });
  it('bounds schema recursion and total node count', () => {
    let schema: Record<string, unknown> = { type: 'string' };
    for (let n = 0; n < 20; n++) {
      schema = { type: 'object', properties: { nested: schema }, additionalProperties: false };
    }
    expect(() => parseCustomEffectCatalog(withProp(schema))).toThrow(/depth/);
    const properties = Object.fromEntries(Array.from({ length: 1100 }, (_, n) => [`key${n}`, { type: 'string' }]));
    expect(() =>
      parseCustomEffectCatalog(
        document({
          ...product,
          propsSchema: {
            type: 'object',
            properties,
            additionalProperties: false,
          },
        })
      )
    ).toThrow(/node/);
  });
  it('rejects non-JSON input, cycles and oversized in-memory documents', () => {
    const cycle: Record<string, unknown> = document();
    cycle.cycle = cycle;
    for (const input of [
      cycle,
      document({ ...product, description: 'x'.repeat(256 * 1024) }),
      document({ ...product, propsSchema: { ...product.propsSchema, default: () => 1 } }),
    ]) {
      expect(() => parseCustomEffectCatalog(input)).toThrow(/effect_catalog_invalid/);
    }
  });
  it.skipIf(process.platform === 'win32')('rejects FIFO catalogs without blocking on open', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leclap-catalog-fifo-'));
    directories.push(dir);
    const fifo = path.join(dir, 'catalog.json');
    expect(spawnSync('mkfifo', [fifo], { timeout: 2000 }).status).toBe(0);
    const moduleUrl = new URL('../src/effects/custom-effect-catalog.ts', import.meta.url).href;
    const script = `import {loadCustomEffectCatalog} from ${JSON.stringify(moduleUrl)};
      try { loadCustomEffectCatalog(${JSON.stringify(fifo)}); }
      catch (error) { console.log(error.message); }`;
    const loaderUrl = pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href;
    const child = spawnSync(process.execPath, ['--import', loaderUrl, '--input-type=module', '-e', script], {
      cwd: fileURLToPath(new URL('../../../', import.meta.url)),
      timeout: 2000,
      encoding: 'utf8',
    });
    const diagnostics = `error=${child.error?.message ?? 'none'}; signal=${child.signal}; stderr=${child.stderr}`;
    expect(child.error, diagnostics).toBeUndefined();
    expect(child.status, diagnostics).toBe(0);
    expect(child.stdout).toMatch(/effect_catalog_invalid.*regular file/);
  });
  it('loads bounded regular JSON files and reports malformed or oversized files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leclap-catalog-'));
    directories.push(dir);
    const file = path.join(dir, 'catalog.json');
    fs.writeFileSync(file, JSON.stringify(document()));
    const catalog = loadCustomEffectCatalog(file);
    fs.unlinkSync(file);
    expect(getEffectDefinition('studio.product', '1.0.0', catalog).props.parse({})).toEqual({ headline: 'Product' });
    fs.writeFileSync(file, '{');
    expect(() => loadCustomEffectCatalog(file)).toThrow(/effect_catalog_invalid.*JSON/);
    fs.writeFileSync(file, ' '.repeat(256 * 1024 + 1));
    expect(() => loadCustomEffectCatalog(file)).toThrow(/effect_catalog_invalid.*256/);
    expect(() => loadCustomEffectCatalog(dir)).toThrow(/effect_catalog_invalid.*regular/);
    expect(() => loadCustomEffectCatalog(path.join(dir, 'missing'))).toThrow(/effect_catalog_invalid/);
  });
});
