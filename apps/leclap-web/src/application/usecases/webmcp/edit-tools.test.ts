import { describe, expect, it } from 'vitest';
import { textOf } from './results';
import { STARTER_PRESETS, buildDescriptor, patch } from '@leclap/creative-kit/editor';
import { createFakePort, toolCaller } from './fake-port';

function preset() {
  return STARTER_PRESETS[0].build();
}

async function setup() {
  const port = createFakePort(preset());
  const call = toolCaller(port);
  const revision = (await call('get_template')).data.revision as string;

  return { port, call, revision };
}

describe('edit_template', () => {
  it('applies a JSON Patch as one history step and returns the new revision', async () => {
    const { port, call, revision } = await setup();
    const before = port.getState();
    const result = await call('edit_template', {
      expectedRevision: revision,
      operations: [{ op: 'replace', path: '/sections/0/options/backgroundColor', value: '#123456' }],
    });

    expect(result.isError).toBeUndefined();
    expect(result.data.revision).not.toBe(revision);
    expect(result.data.changedSections).toEqual(['color_1']);
    expect(port.commits).toHaveLength(1);
    expect(port.getState().sections[0]).toMatchObject({ kind: 'color', color: '#123456' });
    // Untouched sections keep their editor objects.
    expect(port.getState().sections[1]).toBe(before.sections[1]);
    port.undo();
    expect(port.getState()).toBe(before);
  });

  it('rejects a stale revision with revision_conflict and commits nothing', async () => {
    const { port, call } = await setup();
    const result = await call('edit_template', {
      expectedRevision: 'stale',
      operations: [{ op: 'replace', path: '/sections/0/options/duration', value: 5 }],
    });

    expect(result.isError).toBe(true);
    expect(result.data.code).toBe('revision_conflict');
    expect(textOf(result)).toContain('revision_conflict: template changed');
    expect(port.commits).toHaveLength(0);
  });

  it('is atomic: one bad operation leaves the draft unchanged', async () => {
    const { port, call, revision } = await setup();
    const before = port.getState();
    const result = await call('edit_template', {
      expectedRevision: revision,
      operations: [
        { op: 'replace', path: '/sections/0/options/duration', value: 6 },
        { op: 'replace', path: '/sections/9/options/duration', value: 6 },
      ],
    });

    expect(result.data.code).toBe('invalid_input');
    expect(result.data.operation).toBe(1);
    expect(port.getState()).toBe(before);
  });

  it('refuses edits that add validation errors, with MCP-shaped findings', async () => {
    const { port, call, revision } = await setup();
    const result = await call('edit_template', {
      expectedRevision: revision,
      operations: [{ op: 'replace', path: '/sections/0/options/duration', value: -3 }],
    });

    expect(result.data.code).toBe('invalid_template');
    const errors = result.data.errors as Array<{ path: string; code: string; message: string }>;
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toEqual(expect.objectContaining({ path: expect.any(String), code: expect.any(String) }));
    expect(port.commits).toHaveLength(0);
  });

  it('refuses effect sections', async () => {
    const { call, revision } = await setup();
    const result = await call('edit_template', {
      expectedRevision: revision,
      operations: [
        {
          op: 'add',
          path: '/sections/-',
          value: {
            name: 'fx',
            type: 'effect',
            options: { duration: 3 },
            effect: { id: 'x', version: '1.0.0', props: {} },
          },
        },
      ],
    });

    expect(result.data.code).toBe('builder_unsupported_section');
  });

  it('reports fields the builder drops, and refuses an edit it drops entirely as no_effect', async () => {
    const { port, call, revision } = await setup();
    const partly = await call('edit_template', {
      expectedRevision: revision,
      operations: [
        { op: 'replace', path: '/sections/0/options/duration', value: 4 },
        { op: 'replace', path: '/sections/0/name', value: 'intro' },
      ],
    });

    // A builder-assigned section name is not a drop.
    expect(partly.isError).toBeUndefined();
    expect(partly.data.dropped).toBeUndefined();

    const mixed = await call('edit_template', {
      expectedRevision: partly.data.revision,
      operations: [
        { op: 'replace', path: '/sections/0/options/duration', value: 5 },
        { op: 'add', path: '/global/fps', value: 30 },
      ],
    });

    expect(mixed.isError).toBeUndefined();
    expect(mixed.data.dropped).toEqual(['/global/fps']);
    expect(mixed.data.warnings).toEqual([expect.objectContaining({ code: 'builder_dropped_field' })]);

    const none = await call('edit_template', {
      expectedRevision: mixed.data.revision,
      operations: [{ op: 'add', path: '/global/fps', value: 30 }],
    });

    expect(none.data.code).toBe('no_effect');
    expect(none.data.dropped).toEqual(['/global/fps']);
    expect(port.commits).toHaveLength(2);
  });

  it('refuses URLs the policy does not allow', async () => {
    const { call, revision } = await setup();
    const result = await call('edit_template', {
      expectedRevision: revision,
      operations: [{ op: 'add', path: '/global/watermark', value: { url: 'data:image/png;base64,AAAA' } }],
    });

    expect(result.data.code).toBe('invalid_input');
    expect(String(result.data.message)).toContain('data:');
  });
});

describe('section tools', () => {
  it('add_section inserts a default section at a position and highlights it', async () => {
    const { port, call, revision } = await setup();
    const result = await call('add_section', { expectedRevision: revision, type: 'color_background', position: 1 });

    expect(result.isError).toBeUndefined();
    expect(port.getState().sections).toHaveLength(4);
    expect(port.getState().sections[1].kind).toBe('color');
    expect(port.commits[0].changed).toEqual([1]);
  });

  it('add_section merges a descriptor fragment', async () => {
    const { port, call, revision } = await setup();
    await call('add_section', {
      expectedRevision: revision,
      type: 'color_background',
      section: { options: { backgroundColor: '#101820', duration: 2 }, titleCard: { headline: { en: 'Hello' } } },
    });

    const added = port.getState().sections.at(-1);
    expect(added).toMatchObject({ kind: 'color', color: '#101820', duration: 2 });
    expect(JSON.stringify(buildDescriptor(port.getState()))).toContain('Hello');
  });

  it('add_section adds a music section even before it has tracks', async () => {
    const { port, call, revision } = await setup();
    const result = await call('add_section', { expectedRevision: revision, type: 'music' });

    expect(result.isError).toBeUndefined();
    expect(port.getState().sections.at(-1)?.kind).toBe('music');
    expect(
      (await call('add_section', { expectedRevision: result.data.revision, type: 'music', section: {} })).data.code
    ).toBe('invalid_input');
  });

  it('add_section needs a known partial ref', async () => {
    const { call, revision } = await setup();

    expect((await call('add_section', { expectedRevision: revision, type: 'partial' })).data.code).toBe(
      'invalid_input'
    );
    expect(
      (await call('add_section', { expectedRevision: revision, type: 'partial', section: { ref: 'nope' } })).data.code
    ).toBe('invalid_template');
  });

  it('remove_section by name and move_section by position', async () => {
    const { port, call, revision } = await setup();
    const removed = await call('remove_section', { expectedRevision: revision, name: 'color_2' });

    expect(removed.data.changedSections).toEqual(['color_2']);
    expect(port.getState().sections).toHaveLength(2);

    const moved = await call('move_section', { expectedRevision: removed.data.revision, from: 0, to: 1 });

    expect(moved.isError).toBeUndefined();
    expect(port.getState().sections.map((section) => section.kind)).toEqual(['video', 'color']);
    expect((await call('move_section', { expectedRevision: moved.data.revision, from: 0, to: 0 })).data.code).toBe(
      'no_effect'
    );
  });

  it('remove_section keeps the last section', async () => {
    const port = createFakePort();
    const call = toolCaller(port);
    const revision = (await call('get_template')).data.revision;

    expect((await call('remove_section', { expectedRevision: revision, position: 0 })).data.code).toBe('invalid_input');
  });

  it('set_texts replaces copy at reported pointers only, sanitized, in one step', async () => {
    const { port, call, revision } = await setup();
    const result = await call('set_texts', {
      expectedRevision: revision,
      edits: [
        { pointer: '/sections/0/titleCard/headline/en', text: 'Meet\u202E the team' },
        { pointer: '/sections/2/titleCard/headline/en', text: 'Bye' },
      ],
    });

    expect(result.isError).toBeUndefined();
    expect(port.commits).toHaveLength(1);
    const descriptor = JSON.stringify(buildDescriptor(port.getState()));
    expect(descriptor).toContain('Meet the team');
    expect(descriptor).toContain('Bye');

    const unknown = await call('set_texts', {
      expectedRevision: result.data.revision,
      edits: [{ pointer: '/sections/1/options/duration', text: 'x' }],
    });
    expect(unknown.data.code).toBe('not_found');
  });

  it('rejects on-screen text over the limit', async () => {
    const { call, revision } = await setup();
    const result = await call('set_texts', {
      expectedRevision: revision,
      edits: [{ pointer: '/sections/0/titleCard/headline/en', text: 'x'.repeat(501) }],
    });

    expect(result.data.code).toBe('invalid_input');
  });
});

describe('undo', () => {
  it('reverts the agent steps that are still present, newest first', async () => {
    const { port, call, revision } = await setup();
    const start = port.getState();
    const first = await call('add_section', { expectedRevision: revision, type: 'color_background' });
    await call('add_section', { expectedRevision: first.data.revision, type: 'form' });

    expect((await call('undo')).isError).toBeUndefined();
    expect(port.getState().sections).toHaveLength(4);
    expect((await call('undo')).isError).toBeUndefined();
    expect(port.getState()).toBe(start);
    expect((await call('undo')).data.code).toBe('not_found');
  });

  it('refuses once the user has edited since', async () => {
    const { port, call, revision } = await setup();
    await call('add_section', { expectedRevision: revision, type: 'color_background' });
    port.userSet(patch(port.getState(), { name: 'Mine' }));
    const result = await call('undo');

    expect(result.data.code).toBe('not_found');
    expect(port.getState().name).toBe('Mine');
  });
});
