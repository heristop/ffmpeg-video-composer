import 'reflect-metadata';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';

import { createServer } from '../src/server.js';

// Every tool's name and description is paid for on every agent turn, so the surface is pinned: a new
// tool has to be added here on purpose.
const ALWAYS = [
  'analyze_music',
  'analyze_sound',
  'compose_video',
  'edit_template',
  'extract_style',
  'get_capabilities',
  'get_motion_catalog',
  'get_samples',
  'get_template_schema',
  'open_in_builder',
  'probe_media',
  'render_frames',
  'transcribe_media',
  'validate_template',
];
const REMOTION = ['get_effect_schema', 'render_preview', 'render_remotion_clip'];

async function toolNames(allowRemotion: boolean): Promise<string[]> {
  const server = createServer({ mediaDir: '/unused', outputDir: '/unused', renderTimeoutMs: 1000, allowRemotion });
  const client = new Client({ name: 'surface-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  try {
    return (await client.listTools()).tools.map((tool) => tool.name).sort();
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
}

describe('the MCP tool surface', () => {
  it('registers exactly the authoring tools by default', async () => {
    expect(await toolNames(false)).toEqual(ALWAYS);
  });

  it('adds only the Remotion trio when Remotion is allowed', async () => {
    expect(await toolNames(true)).toEqual([...ALWAYS, ...REMOTION].sort());
  });
});
