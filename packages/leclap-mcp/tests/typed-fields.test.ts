import 'reflect-metadata';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { runRender } from '../src/compose/renderRunner.js';
import { createServer } from '../src/server.js';
import { fieldValues } from '../src/compose/field-values.js';
import { handleValidate } from '../src/tools/validateTemplate.js';
import { prepareCompose } from '../src/tools/composeVideo.js';
import { validateEffects } from '../src/effects/title-registry.js';
import { runTitleEffect } from '../src/effects/effect-runner.js';

vi.mock('../src/compose/renderRunner.js', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  runRender: vi.fn(),
}));
vi.mock('../src/effects/title-registry.js', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  validateEffects: vi.fn(),
}));
vi.mock('../src/effects/effect-runner.js', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  runTitleEffect: vi.fn(),
}));

const template = {
  global: { fields: { HOLD: { type: 'number', default: 3 }, TITLE: { type: 'text', required: true } } },
  sections: [
    {
      name: 'card',
      type: 'color_background',
      options: { backgroundColor: '#101014', duration: '{{ HOLD }}' },
      filters: [{ type: 'drawtext', values: { text: { en: '{{ TITLE }}' } } }],
    },
  ],
};

type Resolved = { descriptor: { sections: Array<{ options: { duration: unknown } }> }; values: unknown };

describe('fieldValues', () => {
  it('turns typed MCP values into the engine strings', () => {
    expect(fieldValues({ HOLD: 4, on: true, TITLE: 'Hi' })).toEqual({ HOLD: '4', on: 'true', TITLE: 'Hi' });
    expect(fieldValues(undefined)).toBeUndefined();
  });
});

describe('validate_template include: ["resolved"]', () => {
  it('returns the descriptor a render would see, with the typed values', async () => {
    const result = (await handleValidate(
      { template, include: ['resolved'], fields: { TITLE: 'Hi', HOLD: 5 } },
      {} as never
    )) as unknown as { isError?: boolean; structuredContent: { valid: boolean; resolved: Resolved } };

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent.valid).toBe(true);
    expect(result.structuredContent.resolved.descriptor.sections[0].options.duration).toBe(5);
    expect(result.structuredContent.resolved.values).toEqual({ HOLD: 5, TITLE: 'Hi' });
  });

  it('lists what a render would refuse', async () => {
    const result = (await handleValidate(
      { template, include: ['resolved'], fields: { HOLD: 'slow' } },
      {} as never
    )) as unknown as { isError?: boolean; content: unknown };

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('field_type_mismatch');
    expect(JSON.stringify(result.content)).toContain('TITLE');
  });
});

describe('validate_template', () => {
  it('reports the declared field contract', async () => {
    const result = (await handleValidate({ template }, {} as never)) as {
      structuredContent: { fields?: unknown[] };
    };

    expect(result.structuredContent.fields).toEqual([
      { name: 'HOLD', type: 'number', required: false, default: 3 },
      { name: 'TITLE', type: 'text', required: true },
    ]);
  });
});

describe('the MCP server', () => {
  const server = createServer({
    mediaDir: '/unused',
    outputDir: '/unused',
    renderTimeoutMs: 1000,
    allowRemotion: false,
  });
  const client = new Client({ name: 'fields-client', version: '1.0.0' });

  beforeAll(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });
  afterAll(async () => {
    await Promise.all([client.close(), server.close()]);
  });

  it('takes typed fields on validate_template, compose_video and render_frames', async () => {
    const { tools } = await client.listTools();
    const fieldsOf = (name: string) => tools.find((tool) => tool.name === name)?.inputSchema.properties?.fields;

    expect(tools.map((tool) => tool.name)).not.toContain('get_resolved_template');
    expect(JSON.stringify(fieldsOf('validate_template'))).toContain('number');
    expect(JSON.stringify(fieldsOf('compose_video'))).toContain('number');
    expect(JSON.stringify(fieldsOf('render_frames'))).toContain('number');
  });
});

describe('compose_video', () => {
  it('refuses a template whose required field has no value, before rendering', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'leclap-fields-'));
    const server = createServer({ mediaDir: outputDir, outputDir, renderTimeoutMs: 1000, allowRemotion: false });
    const client = new Client({ name: 'compose-fields', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    try {
      const result = await client.callTool({ name: 'compose_video', arguments: { template, fields: { HOLD: 4 } } });

      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain('TITLE');
      expect(vi.mocked(runRender)).not.toHaveBeenCalled();
    } finally {
      await Promise.all([client.close(), server.close()]);
      await fs.rm(outputDir, { recursive: true, force: true });
    }
  });
});

describe('compose_video with an effect section', () => {
  const withEffect = {
    global: {
      fields: { HOLD: { type: 'number', default: 3 }, TITLE: { type: 'text' }, C: { type: 'color' } },
    },
    sections: [
      {
        name: 'title',
        type: 'effect',
        options: { duration: 2 },
        effect: { id: 'leclap.title-reveal', version: '1.0.0', props: { headline: '{{ TITLE }}' }, assets: {} },
      },
      {
        name: 'card',
        type: 'color_background',
        options: { backgroundColor: '{{ C }}', duration: '{{ HOLD }}' },
        filters: [{ type: 'drawtext', values: { text: { en: '{{ TITLE }}' } } }],
      },
    ],
  };

  type Card = { options: { duration: unknown; backgroundColor: unknown }; filters: Array<{ values: unknown }> };

  it('renders the values that were provided, in the effect and around it', async () => {
    const mediaDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'leclap-fields-effect-')));
    const config = { mediaDir, outputDir: mediaDir, renderTimeoutMs: 1000, allowRemotion: true };
    vi.mocked(validateEffects).mockResolvedValue(new Map([['title', {}]]) as never);
    vi.mocked(runTitleEffect).mockResolvedValue({
      directory: path.join(mediaDir, 'job'),
      results: [{ path: path.join(mediaDir, 'title.mp4'), metadata: { duration: 2 } }],
    } as never);

    try {
      const fields = { HOLD: '6', TITLE: 'Hi', C: '#ff0000' };
      const prepared = await prepareCompose({ template: withEffect, fields } as never, config as never);

      expect((prepared as { content?: unknown }).content).toBeUndefined();

      const card = (prepared as { descriptor: { sections: Card[] } }).descriptor.sections[1];
      const effectInput = vi.mocked(validateEffects).mock.calls[0][0] as { sections: unknown[] };

      expect(card.options).toEqual({ backgroundColor: '#ff0000', duration: 6 });
      expect(card.filters[0].values).toEqual({ text: { en: 'Hi' } });
      expect(JSON.stringify(effectInput.sections[0])).toContain('"headline":"Hi"');
    } finally {
      await fs.rm(mediaDir, { recursive: true, force: true });
    }
  });
});
