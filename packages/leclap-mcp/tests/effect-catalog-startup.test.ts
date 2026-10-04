import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createServer, snapshotEffectConfig } from '../src/server.js';

const handlers = new Map<string, (args: any) => any>();
vi.mock('@modelcontextprotocol/server', () => ({
  McpServer: class {
    registerTool(name: string, _metadata: unknown, handler: (args: any) => any) {
      handlers.set(name, handler);
    }
    registerPrompt() {}
  },
}));
let dir: string;
afterEach(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true });
  handlers.clear();
});
const catalog = {
  schemaVersion: 1,
  effects: [
    {
      id: 'studio.product-reveal',
      version: '1.0.0',
      compositionId: 'LeclapProductReveal',
      description: 'Original',
      assets: {},
      propsSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
  ],
};
it('loads one detached immutable snapshot at startup and rejects invalid restart catalogs', async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'leclap-catalog-startup-'));
  const file = path.join(dir, 'catalog.json');
  await fs.writeFile(file, JSON.stringify(catalog));
  const config = { mediaDir: dir, outputDir: dir, allowRemotion: true, renderTimeoutMs: 1000, effectCatalogPath: file };
  createServer(config);
  const handler = handlers.get('get_effect_schema')!;
  const before = await handler({ id: 'studio.product-reveal' });
  expect(before.structuredContent.description).toBe('Original');
  await fs.writeFile(
    file,
    JSON.stringify({ ...catalog, effects: [{ ...catalog.effects[0], description: 'Changed' }] })
  );
  expect((await handler({ id: 'studio.product-reveal' })).structuredContent).toEqual(before.structuredContent);
  createServer(config);
  const restarted = await handlers.get('get_effect_schema')!({ id: 'studio.product-reveal' });
  expect(restarted.structuredContent.description).toBe('Changed');
  expect(restarted.structuredContent.definitionHash).not.toBe(before.structuredContent.definitionHash);
  await fs.unlink(file);
  expect((await handler({ list: true })).structuredContent.effects[2].description).toBe('Original');
  expect(() => createServer(config)).toThrow(/catalog/);
  await fs.writeFile(file, '{"schemaVersion":2,"effects":[]}');
  expect(() => createServer(config)).toThrow(/catalog/);
});

it('reuses a preloaded process snapshot without reopening its configured file', async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'leclap-catalog-preload-'));
  const file = path.join(dir, 'catalog.json');
  await fs.writeFile(file, JSON.stringify(catalog));
  const config = snapshotEffectConfig({
    mediaDir: dir,
    outputDir: dir,
    allowRemotion: true,
    renderTimeoutMs: 1000,
    effectCatalogPath: file,
  });
  expect(Object.isFrozen(config.effectCatalog)).toBe(true);
  expect(Object.isFrozen(config.effectCatalog?.effects[0])).toBe(true);
  expect(JSON.parse(JSON.stringify(config.effectCatalog))).toEqual(catalog);
  await fs.unlink(file);
  createServer(config);
  expect((await handlers.get('get_effect_schema')!({ list: true })).structuredContent.effects).toHaveLength(3);
});
