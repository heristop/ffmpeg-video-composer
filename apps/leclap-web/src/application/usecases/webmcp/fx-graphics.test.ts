// The animation picker writes engine effects as section `graphics` (fx lights, strokes); an agent edit
// through edit_template must carry them through the editor model and back unchanged, and the builder's
// own inserts must survive the same trip.
import { describe, expect, it } from 'vitest';
import { ENGINE_LIBRARY, STARTER_PRESETS, buildDescriptor, draftGraphic } from '@leclap/creative-kit/editor';
import { createFakePort, toolCaller } from './fake-port';

function graphicsOf(state: Parameters<typeof buildDescriptor>[0]): unknown[] | undefined {
  return (buildDescriptor(state).sections?.at(0) as { graphics?: unknown[] } | undefined)?.graphics;
}

async function setup() {
  const port = createFakePort(STARTER_PRESETS[0].build());
  const call = toolCaller(port);
  const revision = (await call('get_template')).data.revision as string;

  return { port, call, revision };
}

describe('edit_template with engine effects', () => {
  it('round-trips fx and stroke graphics, and edits one in place', async () => {
    const { port, call, revision } = await setup();
    const graphics = [
      { type: 'fx', effect: 'sheen', target: 'frame', at: 0.3, direction: 'right', width: 0.12, seed: 42 },
      { type: 'fx', effect: 'glint', path: 'orbit', target: { x: 100, y: 80, w: 600, h: 400, radius: 24 }, at: 0.9 },
      { type: 'corners', at: 0.2, inset: 48, trace: 'clockwise', exit: 'expand', color: '$color.accent' },
    ];
    const added = await call('edit_template', {
      expectedRevision: revision,
      operations: [{ op: 'add', path: '/sections/0/graphics', value: graphics }],
    });

    expect(added.isError).toBeUndefined();
    expect(graphicsOf(port.getState())).toEqual(graphics);

    const tuned = await call('edit_template', {
      expectedRevision: added.data.revision as string,
      operations: [{ op: 'add', path: '/sections/0/graphics/0/tilt', value: 18 }],
    });

    expect(tuned.isError).toBeUndefined();
    expect(graphicsOf(port.getState())?.[0]).toEqual({ ...graphics[0], tilt: 18 });
  });

  it('carries every library placement the builder inserts', async () => {
    const { port, call, revision } = await setup();
    const section = port.getState().sections[0];
    const graphics = ENGINE_LIBRARY.slice(0, 12).map((entry) =>
      draftGraphic(entry, { section, orientation: port.getState().orientation })
    );
    const result = await call('edit_template', {
      expectedRevision: revision,
      operations: [{ op: 'add', path: '/sections/0/graphics', value: graphics }],
    });

    expect(result.isError).toBeUndefined();
    expect(graphicsOf(port.getState())).toEqual(graphics);
  });

  it('refuses an fx parameter outside its range', async () => {
    const { port, call, revision } = await setup();
    const result = await call('edit_template', {
      expectedRevision: revision,
      operations: [{ op: 'add', path: '/sections/0/graphics', value: [{ type: 'fx', effect: 'sheen', width: 4 }] }],
    });

    expect(result.data.code).toBe('invalid_template');
    expect(port.commits).toHaveLength(0);
  });
});
