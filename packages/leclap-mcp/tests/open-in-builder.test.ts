import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { McpServer, InMemoryTransport } from '@modelcontextprotocol/server';
import { decodeTemplatePayload, readTemplateLinkPayload } from 'ffmpeg-video-composer';
import { openInBuilder, registerOpenInBuilder } from '../src/tools/open-in-builder.js';
import { createServer } from '../src/server.js';

const template = {
  meta: { name: 'Launch' },
  sections: [
    { name: 'intro', type: 'color_background', options: { duration: 3, backgroundColor: '#101820' } },
    { name: 'demo', type: 'video', options: { videoUrl: '/Users/me/clips/demo.mp4' } },
  ],
};

describe('open_in_builder', () => {
  it('returns a builder link carrying the template in its fragment, and the media to re-bind', async () => {
    const result = await openInBuilder({ template });

    expect(result.url.startsWith('https://leclap.dev/studio/builder#t=v1.')).toBe(true);
    expect(result.length).toBe(result.url.length);
    expect(result.mediaToRebind).toEqual([
      { pointer: '/sections/1/options/videoUrl', value: '/Users/me/clips/demo.mp4', reason: 'local_path' },
    ]);
    expect(await decodeTemplatePayload(readTemplateLinkPayload(new URL(result.url).hash) ?? '')).toEqual(template);
  });

  it('honours a base URL such as a local dev server or a locale prefix', async () => {
    const local = await openInBuilder({ template, baseUrl: 'http://localhost:5173' });
    const french = await openInBuilder({ template, baseUrl: 'https://leclap.dev/fr' });

    expect(local.url.startsWith('http://localhost:5173/studio/builder#t=')).toBe(true);
    expect(french.url.startsWith('https://leclap.dev/fr/studio/builder#t=')).toBe(true);
  });

  it('warns when the link opens anywhere but leclap.dev, since that page can read the fragment', async () => {
    const official = await openInBuilder({ template, baseUrl: 'https://leclap.dev/fr' });
    const local = await openInBuilder({ template, baseUrl: 'http://localhost:5173' });

    expect(official.warnings.join(' ')).not.toMatch(/fragment/);
    expect(local.warnings.join(' ')).toMatch(/http:\/\/localhost:5173, not https:\/\/leclap\.dev.*fragment/);
  });

  it('is listed and answers an invalid template as isError', async () => {
    const server = new McpServer({ name: 'open-test', version: '1.0.0' });
    registerOpenInBuilder(server);
    const client = new Client({ name: 'open-test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    try {
      const listed = await client.listTools();
      const tool = listed.tools.find((entry) => entry.name === 'open_in_builder');

      expect(tool?.inputSchema.properties?.template).toMatchObject({ type: 'object' });
      expect(tool?.description).toMatch(/fragment/);

      const ok = await client.callTool({ name: 'open_in_builder', arguments: { template } });

      expect(ok.isError).toBeUndefined();
      expect(ok.structuredContent).toMatchObject({ mediaToRebind: [{ reason: 'local_path' }] });

      const invalid = await client.callTool({
        name: 'open_in_builder',
        arguments: { template: { sections: [{ name: 'x', type: 'nope' }] } },
      });

      expect(invalid.isError).toBe(true);
      expect(JSON.stringify(invalid.content)).toContain('invalid_template');

      const badBase = await client.callTool({
        name: 'open_in_builder',
        arguments: { template, baseUrl: 'ftp://example.com' },
      });

      expect(badBase.isError).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('is always registered on the default server', async () => {
    const server = createServer({
      mediaDir: '/unused',
      outputDir: '/unused',
      renderTimeoutMs: 1000,
      allowRemotion: false,
    });
    const client = new Client({ name: 'open-default-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    try {
      expect((await client.listTools()).tools.map((tool) => tool.name)).toContain('open_in_builder');
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });
});
