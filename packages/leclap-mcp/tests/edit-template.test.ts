import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { McpServer, InMemoryTransport } from '@modelcontextprotocol/server';
import { templateRevision } from '../src/effects/template-revision.js';
import { editTemplate, registerEditTemplate } from '../src/tools/editTemplate.js';

const template = {
  sections: [
    { name: 'intro', type: 'color_background', options: { duration: 3, backgroundColor: '#101820' } },
    { name: 'outro', type: 'color_background', options: { duration: 2, backgroundColor: '#000000' } },
  ],
};

function edit(operations: unknown[], expectedRevision = templateRevision(template)) {
  return editTemplate({ template, expectedRevision, operations });
}

describe('edit_template', () => {
  it('applies a JSON Patch atomically and returns the new revision and changed paths', () => {
    const before = structuredClone(template);
    const result = edit([
      { op: 'test', path: '/sections/0/name', value: 'intro' },
      { op: 'replace', path: '/sections/0/options/duration', value: 4 },
      { op: 'remove', path: '/sections/1' },
    ]);

    expect(result.template.sections).toEqual([
      { name: 'intro', type: 'color_background', options: { duration: 4, backgroundColor: '#101820' } },
    ]);
    expect(result.revision).toBe(templateRevision(result.template));
    expect(result.changedPaths).toEqual(['/sections/0/name', '/sections/0/options/duration', '/sections/1']);
    expect(template).toEqual(before);
  });

  it('matches the revision the web builder computes for the same JSON', () => {
    expect(templateRevision({ b: 1, a: [1, 2] })).toBe(templateRevision({ a: [1, 2], b: 1 }));
  });

  it('rejects a stale revision before applying anything', () => {
    expect(() => edit([{ op: 'remove', path: '/sections/1' }], 'stale')).toThrow('revision_conflict');
  });

  it('is all-or-nothing: a failing operation or an invalid result changes nothing', () => {
    expect(() =>
      edit([
        { op: 'replace', path: '/sections/0/options/duration', value: 4 },
        { op: 'remove', path: '/sections/9' },
      ])
    ).toThrow('path_not_found');
    expect(() => edit([{ op: 'replace', path: '/sections/0/options/duration', value: -1 }])).toThrow(/Invalid/i);
    expect(() => edit([{ op: 'add', path: '/__proto__/x', value: 1 }])).toThrow('unsafe_pointer');
  });

  it('needs operations or effectProps', () => {
    expect(() => editTemplate({ template, expectedRevision: templateRevision(template) })).toThrow(
      /operations or effectProps/
    );
  });

  it('applies operations, then effectProps by section name, in one revision-guarded batch', () => {
    const withEffect = {
      sections: [
        ...template.sections,
        {
          name: 'title',
          type: 'effect',
          options: { duration: 10 },
          effect: { id: 'leclap.title-reveal', version: '1.0.0', props: { headline: 'A' }, assets: {} },
        },
      ],
    };
    const result = editTemplate({
      template: withEffect,
      expectedRevision: templateRevision(withEffect),
      operations: [{ op: 'remove', path: '/sections/1' }],
      effectProps: [{ section: 'title', props: { headline: 'B' } }],
    });

    const sections = result.template.sections as unknown[];

    expect(sections).toHaveLength(2);
    expect(sections[1]).toMatchObject({ effect: { props: { headline: 'B' } } });
    expect(result.changedPaths).toEqual(['/sections/1']);
    expect(result.changedSections).toEqual(['title']);
  });

  it('is listed with an object template schema and answers errors as isError', async () => {
    const server = new McpServer({ name: 'edit-test', version: '1.0.0' });
    registerEditTemplate(server);
    const client = new Client({ name: 'edit-test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    try {
      const listed = await client.listTools();
      const schema = listed.tools.find((tool) => tool.name === 'edit_template')?.inputSchema;
      expect(schema?.properties?.template).toMatchObject({ type: 'object' });

      const ok = await client.callTool({
        name: 'edit_template',
        arguments: {
          template,
          expectedRevision: templateRevision(template),
          operations: [{ op: 'replace', path: '/sections/1/options/duration', value: 5 }],
        },
      });
      expect(ok.isError).toBeUndefined();
      expect(ok.structuredContent).toMatchObject({ changedPaths: ['/sections/1/options/duration'] });

      const stale = await client.callTool({
        name: 'edit_template',
        arguments: { template, expectedRevision: 'x', operations: [{ op: 'remove', path: '/sections/1' }] },
      });
      expect(stale.isError).toBe(true);
      expect(JSON.stringify(stale.content)).toContain('revision_conflict');
    } finally {
      await client.close();
    }
  });
});
