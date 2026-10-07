import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { STARTER_PRESETS } from '@leclap/creative-kit/editor';
import { ALL_CAPABILITIES, createFakePort, TEST_ORIGIN, toolCaller } from './fake-port';
import { BUILDER_TOOL_DEFINITIONS, buildBuilderTools } from './registry';
import { BUILDER_TOOL_NAMES, CORE_TOOL_NAMES } from './tool-names';
import { defineTool, type ToolDefinition } from './types';
import { ok } from './results';

const options = { capabilities: new Set<never>(), origin: TEST_ORIGIN };

describe('registry', () => {
  it('registers the core tools without capabilities, and every tool with them', () => {
    const core = buildBuilderTools(createFakePort(), options);

    expect(core.map((tool) => tool.name).sort()).toEqual([...CORE_TOOL_NAMES].sort());

    const tools = buildBuilderTools(createFakePort(), { ...options, capabilities: ALL_CAPABILITIES });

    expect(tools.map((tool) => tool.name).sort()).toEqual([...BUILDER_TOOL_NAMES].sort());

    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.$schema).toBeUndefined();
      expect(JSON.parse(JSON.stringify(tool.inputSchema))).toEqual(tool.inputSchema);
      expect(tool.name).toMatch(/^[a-z_]{1,128}$/);
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it('annotates read tools, user content and edits', () => {
    const byName = new Map(buildBuilderTools(createFakePort(), options).map((tool) => [tool.name, tool]));

    expect(byName.get('get_template')?.annotations).toEqual({ readOnlyHint: true, untrustedContentHint: true });
    expect(byName.get('list_sections')?.annotations.untrustedContentHint).toBe(true);
    expect(byName.get('get_motion_catalog')?.annotations).toEqual({ readOnlyHint: true });
    expect(byName.get('edit_template')?.annotations).toEqual({ readOnlyHint: false });
    expect(byName.get('edit_template')?.confirm).toBe('ask-before-edit');
    expect(byName.get('undo')?.confirm).toBe('never');
  });

  it('registers capability-gated tools only with the capability, consequential ones confirmed', () => {
    const render = defineTool({
      name: 'render_preview',
      title: 'Render Preview',
      description: 'A phase-2 style consequential tool used to test the registry.',
      kind: 'consequential',
      requires: 'preview-render',
      input: z.object({}),
      run: () => ok({ status: 'done' }),
    });
    const definitions: ToolDefinition[] = [render];

    expect(buildBuilderTools(createFakePort(), options, definitions)).toEqual([]);

    const [tool] = buildBuilderTools(
      createFakePort(),
      { ...options, capabilities: new Set(['preview-render'] as const) },
      definitions
    );

    expect(tool.annotations).toEqual({ readOnlyHint: false, consequentialHint: true });
    expect(tool.confirm).toBe('always');
  });

  it('every built-in definition has a unique name', () => {
    const names = BUILDER_TOOL_DEFINITIONS.map((definition) => definition.name);

    expect(new Set(names).size).toBe(names.length);
  });
});

describe('guarded execution', () => {
  it('refuses invalid and oversized input before running', async () => {
    const call = toolCaller(createFakePort());

    expect((await call('select_section', { position: 'x' })).data.code).toBe('invalid_input');
    expect((await call('validate_template', { template: { blob: 'x'.repeat(600 * 1024) } })).data.code).toBe(
      'too_large'
    );
  });

  it('rate-limits bursts with retryAfterMs', async () => {
    const call = toolCaller(createFakePort(), () => 1000);
    const results = await Promise.all(Array.from({ length: 61 }, () => call('get_motion_catalog', { query: 'x' })));
    const limited = results.filter((result) => result.data.code === 'rate_limited');

    expect(limited).toHaveLength(1);
    expect(limited[0].data.retryAfterMs).toBeGreaterThan(0);
  });

  it('returns aborted for a cancelled call', async () => {
    const [tool] = buildBuilderTools(createFakePort(), options).filter(
      (candidate) => candidate.name === 'get_template'
    );
    const controller = new AbortController();
    controller.abort();

    expect((await tool.execute({}, { signal: controller.signal })).structuredContent?.code).toBe('aborted');
  });

  it('asks before every edit when the user wants it; a decline commits nothing', async () => {
    const port = createFakePort(STARTER_PRESETS[0].build());
    port.ask = true;
    port.answers = [false, true];
    const call = toolCaller(port);
    const revision = (await call('get_template')).data.revision;
    const declined = await call('add_section', { expectedRevision: revision, type: 'form', note: 'Add a\u202E form' });

    expect(declined.data.code).toBe('user_declined');
    expect(port.confirms[0]).toEqual({ tool: 'add_section', kind: 'edit', note: 'Add a form' });
    expect(port.commits).toHaveLength(0);
    expect(port.activity.at(-1)).toMatchObject({ tool: 'add_section', status: 'declined', code: 'user_declined' });

    expect((await call('add_section', { expectedRevision: revision, type: 'form' })).isError).toBeUndefined();
    expect(port.commits).toHaveLength(1);
  });

  it('does not open an unseen confirmation in a background tab', async () => {
    const port = createFakePort();
    port.ask = true;
    port.visible = false;
    const call = toolCaller(port);
    const revision = (await call('get_template')).data.revision;

    expect((await call('add_section', { expectedRevision: revision, type: 'form' })).data.code).toBe(
      'needs_user_attention'
    );
    expect(port.confirms).toHaveLength(0);
  });

  it('runs one mutating call at a time', async () => {
    const port = createFakePort();
    let release: (value: boolean) => void = () => undefined;
    port.ask = true;
    port.confirm = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const call = toolCaller(port);
    const revision = (await call('get_template')).data.revision;
    const first = call('add_section', { expectedRevision: revision, type: 'form' });
    const second = await call('add_section', { expectedRevision: revision, type: 'form' });

    expect(second.data.code).toBe('busy');
    release(true);
    expect((await first).isError).toBeUndefined();
  });

  it('reports each call, with the produced state for edits', async () => {
    const port = createFakePort();
    const call = toolCaller(port);
    const revision = (await call('get_template')).data.revision;
    await call('add_section', { expectedRevision: revision, type: 'color_background', note: 'Intro card' });

    expect(port.activity[0]).toMatchObject({ tool: 'get_template', kind: 'read', status: 'ok', changed: [] });
    expect(port.activity[1]).toMatchObject({ tool: 'add_section', status: 'ok', changed: [1], note: 'Intro card' });
    expect(port.activity[1].produced).toBe(port.getState());
  });

  it('turns a thrown tool error into an isError result', async () => {
    const boom = defineTool({
      name: 'get_template',
      title: 'Boom',
      description: 'Throws, to test that errors never escape the tool.',
      kind: 'read',
      input: z.object({}),
      run: () => {
        throw new Error('kaboom');
      },
    });
    const [tool] = buildBuilderTools(createFakePort(), options, [boom]);

    expect((await tool.execute({})).structuredContent).toMatchObject({ code: 'unavailable', message: 'kaboom' });
  });
});

describe('isolation', () => {
  const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

  function resolveImport(from: string, spec: string): string | null {
    const base = spec.startsWith('@/') ? path.join(srcRoot, spec.slice(2)) : path.resolve(path.dirname(from), spec);

    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }

    return null;
  }

  function appImports(file: string): string[] {
    const text = fs.readFileSync(file, 'utf8');
    const specs = [...text.matchAll(/(?:from|import\()\s*'([^']+)'/g)].map((match) => match[1]);

    return specs
      .filter((spec) => spec.startsWith('@/') || spec.startsWith('.'))
      .map((spec) => resolveImport(file, spec))
      .filter((resolved): resolved is string => resolved !== null);
  }

  it('the tool layer never reaches AI keys, IndexedDB media or the media service', () => {
    const seen = new Set<string>();
    const queue = [path.join(srcRoot, 'application/usecases/webmcp/registry.ts')];

    while (queue.length > 0) {
      const file = queue.pop() as string;

      if (seen.has(file)) continue;

      seen.add(file);
      queue.push(...appImports(file));
    }

    const reached = [...seen].map((file) => path.relative(srcRoot, file));

    expect(
      reached.filter((file) => /infrastructure[\\/]ai|browserMediaService|mediaStore|indexeddb/i.test(file))
    ).toEqual([]);
    expect(reached.length).toBeGreaterThan(10);
  });
});
