import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSample, listSamples, SAMPLE_BACKENDS, SAMPLE_CATEGORIES } from 'ffmpeg-video-composer/samples';
import { createServer } from '../src/server.js';

const server = createServer({ mediaDir: '/unused', outputDir: '/unused', renderTimeoutMs: 1000, allowRemotion: false });
const client = new Client({ name: 'sample-client', version: '1.0.0' });
beforeAll(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
});
afterAll(async () => {
  await Promise.all([client.close(), server.close()]);
});
async function call(name: string, args: Record<string, unknown> = {}) {
  return client.callTool({ name, arguments: args });
}
describe('sample discovery on the default MCP server', () => {
  it('advertises one discovery tool with bounded filters while Remotion execution is disabled', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('get_samples');
    expect(tools.map((t) => t.name)).not.toContain('list_samples');
    expect(tools.map((t) => t.name)).not.toContain('get_sample');
    expect(tools.map((t) => t.name)).not.toContain('render_preview');
    const schema = tools.find((t) => t.name === 'get_samples')!.inputSchema;
    expect(schema.properties?.category).toMatchObject({ enum: [...SAMPLE_CATEGORIES] });
    expect(schema.properties?.backend).toMatchObject({ enum: [...SAMPLE_BACKENDS] });
    expect(schema.properties?.query).toMatchObject({ maxLength: 4000 });
    expect(schema.properties?.id).toMatchObject({
      minLength: 1,
      maxLength: 200,
    });
  });
  it('returns matching text and structured metadata for all samples and filtered results', async () => {
    const result = await call('get_samples');
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ samples: listSamples() });
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual(result.structuredContent);
    const filtered = await call('get_samples', { category: 'typography', backend: 'remotion', query: 'BLUR' });
    expect(filtered.structuredContent).toMatchObject({ samples: [{ id: 'editorial-blur-rise' }] });
    expect((filtered.structuredContent as { samples: unknown[] }).samples).toHaveLength(1);
  });
  it('retrieves every descriptor with direction and accurate required inputs', async () => {
    for (const summary of listSamples()) {
      const result = await call('get_samples', { id: summary.id });
      expect(result.isError).toBeUndefined();
      const { partialCatalog, ...sample } = result.structuredContent as Record<string, unknown>;
      const embedded = getSample(summary.id).template.partials ?? [];
      expect(sample).toEqual(getSample(summary.id));
      expect((partialCatalog as { id: string }[] | undefined)?.map((p) => p.id)).toEqual(
        embedded.length > 0 ? embedded.map((p) => p.id) : undefined
      );
      expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual(result.structuredContent);
    }
    const native = (await call('get_samples', { id: 'web-app-promo' })).structuredContent;
    expect(native).toMatchObject({
      backend: 'native',
      creativeDirection: expect.any(String),
      requirements: {
        projectVideos: [{ name: 'video_1', duration: 6.4, captureMode: 'screen' }],
        formFields: expect.arrayContaining([
          { section: 'form_1', name: 'form_1_app', maxLength: 20, label: { en: 'App name' } },
        ]),
      },
    });
    expect((await call('get_samples', { id: 'editorial-type' })).structuredContent).toMatchObject({
      backend: 'remotion',
      requirements: {
        effects: [{ id: 'studio.editorial-type', version: '1.0.0', customCatalog: true }],
        setup: expect.any(Array),
      },
    });
  });
  it.each([
    ['get_samples', { id: 'missing' }],
    ['get_samples', { id: '__proto__' }],
    ['get_samples', { id: 'x'.repeat(201) }],
    ['get_samples', { category: 'invalid' }],
    ['get_samples', { backend: 'invalid' }],
    ['get_samples', { query: 'x'.repeat(4001) }],
  ])('returns useful errors for %s %j', async (name, args) => {
    const result = await call(name, args);
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/sample|category|backend|query/);
  });
});
