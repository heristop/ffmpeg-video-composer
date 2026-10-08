import { describe, expect, it } from 'vitest';
import { templateRevision } from '../src/effects/template-revision.js';
import { Client } from '@modelcontextprotocol/client';
import { McpServer, InMemoryTransport } from '@modelcontextprotocol/server';
import { editTemplate, registerEditTemplate } from '../src/tools/editTemplate.js';
import { validateTemplate } from '../src/compose/validation.js';

const template = {
  sections: [
    {
      name: 'intro',
      type: 'effect',
      effect: {
        id: 'leclap.title-reveal',
        version: '1.0.0',
        props: { headline: 'LECLAP', headlineY: 320 },
        assets: {},
      },
      options: { duration: 10 },
    },
    { name: 'outro', type: 'color_background', options: { duration: 2 } },
  ],
};

describe('JSON effect revisions', () => {
  it('hashes equivalent JSON independently of object key ordering', () => {
    expect(templateRevision({ a: 1, b: { x: 2, y: 3 } })).toBe(templateRevision({ b: { y: 3, x: 2 }, a: 1 }));
    expect(templateRevision({ a: 1 })).not.toBe(templateRevision({ a: 2 }));
  });
  it('patches only named effect props without mutating the caller document', () => {
    const before = structuredClone(template);
    const result = editTemplate({
      template,
      expectedRevision: templateRevision(template),
      effectProps: [{ section: 'intro', props: { headlineY: 260 } }],
    });
    expect((result.template.sections as unknown[])[0]).toMatchObject({
      effect: { props: { headline: 'LECLAP', headlineY: 260 } },
    });
    expect((result.template.sections as unknown[])[1]).toEqual(template.sections[1]);
    expect(template).toEqual(before);
    expect(result.revision).not.toBe(templateRevision(template));
  });
  it('rejects stale revisions before applying changes', () => {
    expect(() =>
      editTemplate({
        template,
        expectedRevision: 'stale',
        effectProps: [{ section: 'intro', props: { headlineY: 260 } }],
      })
    ).toThrow('revision_conflict');
  });
  it('rejects a mixed valid/invalid batch without changing the original', () => {
    const before = structuredClone(template);
    expect(() =>
      editTemplate({
        template,
        expectedRevision: templateRevision(template),
        effectProps: [
          { section: 'intro', props: { headlineY: 260 } },
          { section: 'missing', props: { headline: 'x' } },
        ],
      })
    ).toThrow('Unknown effect section');
    expect(template).toEqual(before);
  });
  it('rejects ambiguous duplicate names and duplicate edits', () => {
    const duplicate = { ...template, sections: [template.sections[0], template.sections[0]] };
    expect(() =>
      editTemplate({
        template: duplicate,
        expectedRevision: templateRevision(duplicate),
        effectProps: [{ section: 'intro', props: { headline: 'x' } }],
      })
    ).toThrow('Ambiguous');
    expect(() =>
      editTemplate({
        template,
        expectedRevision: templateRevision(template),
        effectProps: [
          { section: 'intro', props: { headline: 'x' } },
          { section: 'intro', props: { headline: 'y' } },
        ],
      })
    ).toThrow('Duplicate');
  });
});

describe('patching effects in partials', () => {
  const effect = {
    ...template.sections[0],
    name: '{{ slot }}',
    effect: { ...template.sections[0].effect, props: { headline: '{{ headline }}', headlineY: 320 } },
  };
  const registered = {
    id: 'title',
    variables: { slot: 'intro', headline: 'Default' },
    sections: [effect, template.sections[1]],
  };
  const instance = { type: 'partial', ref: 'title', prefix: 'first-', variables: { headline: 'First' } };

  it('edits an inline partial by its expanded name while retaining authored variables and prefix', () => {
    const authored = {
      sections: [
        {
          ...instance,
          ref: 'unregistered-inline-fallback',
          variables: { slot: 'intro', headline: 'First' },
          sections: [effect, template.sections[1]],
        },
      ],
    };
    const before = structuredClone(authored);
    const result = editTemplate({
      template: authored,
      expectedRevision: templateRevision(authored),
      effectProps: [{ section: 'first-intro', props: { headlineY: 260 } }],
    });
    expect(result.template).toEqual({
      sections: [
        {
          ...authored.sections[0],
          sections: [
            { ...effect, effect: { ...effect.effect, props: { headline: '{{ headline }}', headlineY: 260 } } },
            template.sections[1],
          ],
        },
      ],
    });
    expect(validateTemplate(result.template)).toMatchObject({
      ok: true,
      descriptor: {
        sections: [
          { name: 'first-intro', effect: { props: { headline: 'First', headlineY: 260 } } },
          { name: 'first-outro' },
        ],
      },
    });
    expect(authored).toEqual(before);
    expect(result.changedSections).toEqual(['first-intro']);
  });

  it('materializes only the selected registry instance and merges default variables under overrides', () => {
    const second = { ...instance, prefix: 'second-', variables: { headline: 'Second' } };
    const authored = { partials: [registered], sections: [instance, second, template.sections[0]] };
    const before = structuredClone(authored);
    const result = editTemplate({
      template: authored,
      expectedRevision: templateRevision(authored),
      effectProps: [
        { section: 'first-intro', props: { headlineY: 260 } },
        { section: 'first-intro', props: { headline: 'Edited' } },
      ],
    });
    expect(result.template).toEqual({
      partials: [registered],
      sections: [
        {
          type: 'partial',
          prefix: 'first-',
          variables: { slot: 'intro', headline: 'First' },
          sections: [
            { ...effect, effect: { ...effect.effect, props: { headline: 'Edited', headlineY: 260 } } },
            template.sections[1],
          ],
        },
        second,
        template.sections[0],
      ],
    });
    expect(validateTemplate(result.template)).toMatchObject({
      ok: true,
      descriptor: {
        sections: [
          { name: 'first-intro', effect: { props: { headline: 'Edited', headlineY: 260 } } },
          { name: 'first-outro' },
          { name: 'second-intro', effect: { props: { headline: 'Second', headlineY: 320 } } },
          { name: 'second-outro' },
          template.sections[0],
        ],
      },
    });
    expect(result.revision).not.toBe(templateRevision(authored));
    expect(authored).toEqual(before);
  });

  it('rejects a name shared by a partial and a top-level section', () => {
    const authored = { partials: [registered], sections: [{ ...instance, prefix: '' }, template.sections[0]] };
    expect(() =>
      editTemplate({
        template: authored,
        expectedRevision: templateRevision(authored),
        effectProps: [{ section: 'intro', props: { headlineY: 260 } }],
      })
    ).toThrow('Ambiguous section name: intro');
  });

  it('rejects a mixed partial batch without changing shared definitions or caller instances', () => {
    const authored = { partials: [registered], sections: [instance] };
    const before = structuredClone(authored);
    expect(() =>
      editTemplate({
        template: authored,
        expectedRevision: templateRevision(authored),
        effectProps: [
          { section: 'first-intro', props: { headlineY: 260 } },
          { section: 'missing-intro', props: { headline: 'Wrong instance' } },
        ],
      })
    ).toThrow('Unknown effect section: missing-intro');
    expect(authored).toEqual(before);
  });
});

describe('edit_template effectProps validation', () => {
  it('returns an error for a rejected effect batch and retains the source JSON', async () => {
    const { registerEditTemplate } = await import('../src/tools/editTemplate.js');
    let handler: ((args: unknown) => Promise<{ isError?: boolean; content: { text: string }[] }>) | undefined;
    const server = {
      registerTool: (_name: string, _meta: unknown, callback: typeof handler) => {
        handler = callback;
      },
    };
    registerEditTemplate(server as never, (candidate) => {
      const section = (candidate.sections as { effect: { props: Record<string, unknown> } }[])[0];
      if ((section.effect.props.headlineY as number) > 720) throw new Error('headlineY must fit the frame');
    });
    const before = structuredClone(template);
    const result = await handler!({
      template,
      expectedRevision: templateRevision(template),
      effectProps: [{ section: 'intro', props: { headlineY: 900 } }],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('headlineY');
    expect(template).toEqual(before);
  });
});

it('rejects unknown registered title props before returning a patched document', async () => {
  const { registerEditTemplate } = await import('../src/tools/editTemplate.js');
  const { titlePropsSchema } = await import('../src/effects/title-registry.js');
  let handler: ((args: unknown) => Promise<{ isError?: boolean }>) | undefined;
  const server = {
    registerTool: (_name: string, _meta: unknown, callback: typeof handler) => {
      handler = callback;
    },
  };
  registerEditTemplate(server as never, (candidate) => {
    const sections = candidate.sections as typeof template.sections;
    titlePropsSchema.parse(sections[0].effect!.props);
  });
  const before = structuredClone(template);
  const result = await handler!({
    template,
    expectedRevision: templateRevision(template),
    effectProps: [{ section: 'intro', props: { unknownParameter: 42 } }],
  });
  expect(result.isError).toBe(true);
  expect(template).toEqual(before);
});

const customTemplate = {
  sections: [
    {
      name: 'product',
      type: 'effect',
      options: { duration: 10 },
      effect: { id: 'studio.product-reveal', version: '1.0.0', props: { headline: 'Product' }, assets: {} },
    },
  ],
};
function unsafePatch(location: string) {
  const authored = structuredClone(customTemplate);
  let props: unknown = { headline: 'Updated' };
  if (location === 'edit') props = JSON.parse('{"__proto__":{},"headline":"Updated"}');
  if (location === 'nested edit') props = { control: [JSON.parse('{"__proto__":{}}')] };
  if (location === 'template props') {
    authored.sections[0].effect.props = JSON.parse('{"__proto__":{},"headline":"Product"}');
  }
  if (location === 'template assets') authored.sections[0].effect.assets = JSON.parse('{"__proto__":{}}');
  return {
    template: authored,
    expectedRevision: templateRevision(authored),
    effectProps: [{ section: 'product', props }],
  };
}
it.each(['edit', 'nested edit', 'template props', 'template assets'])(
  'rejects reserved raw keys in pure patch %s',
  (location) => {
    const input = unsafePatch(location);
    const before = JSON.stringify(input);
    expect(() => editTemplate(input)).toThrow(/effect_key_unsafe/);
    expect(JSON.stringify(input)).toBe(before);
  }
);
it('rejects raw reserved keys through actual SDK input validation while preserving object discovery and valid JSON patches', async () => {
  const server = new McpServer({ name: 'edit-props-test', version: '1.0.0' });
  registerEditTemplate(server);
  const client = new Client({ name: 'patch-test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    const listed = await client.listTools();
    const schema = listed.tools.find((tool) => tool.name === 'edit_template')?.inputSchema;
    expect(schema?.properties?.template).toMatchObject({ type: 'object' });
    expect(schema?.properties?.effectProps).toMatchObject({
      type: 'array',
      items: { properties: { props: { type: 'object' } } },
    });
    for (const location of ['edit', 'nested edit', 'template props', 'template assets']) {
      const result = await client.callTool({ name: 'edit_template', arguments: unsafePatch(location) });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain('effect_key_unsafe');
    }
    const authored = { ...customTemplate, metadata: { arbitrary: { constructor: 'preserve ordinary metadata' } } };
    const result = await client.callTool({
      name: 'edit_template',
      arguments: {
        template: authored,
        expectedRevision: templateRevision(authored),
        effectProps: [{ section: 'product', props: { headline: 'Updated' } }],
      },
    });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      template: { metadata: authored.metadata, sections: [{ effect: { props: { headline: 'Updated' } } }] },
    });
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
});
