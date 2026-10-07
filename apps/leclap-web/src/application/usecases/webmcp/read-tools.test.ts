import { describe, expect, it } from 'vitest';
import { textOf } from './results';
import { STARTER_PRESETS, addSection, patchSection, type EditorState } from '@leclap/creative-kit/editor';
import { createFakePort, toolCaller } from './fake-port';
import { resolvePosition } from './read-tools';

function withMusicAndUpload(): EditorState {
  const base = addSection(STARTER_PRESETS[0].build(), 'music');
  const image = addSection(base, 'image');
  const last = image.sections.length - 1;

  return patchSection(image, last, {
    images: [{ id: 'logo', choice: { source: 'upload', key: 'abc123', label: 'holiday-secret.png' } }],
  });
}

describe('get_template', () => {
  it('returns the revision, a redacted descriptor and the editor state', async () => {
    const port = createFakePort(withMusicAndUpload());
    port.selected = 2;
    const result = await toolCaller(port)('get_template');

    expect(result.isError).toBeUndefined();
    expect(result.data.revision).toMatch(/^[0-9a-f]{64}$/);
    expect(result.data.sectionCount).toBe(5);
    expect(result.data.editor).toEqual({
      selectedPosition: 2,
      canUndo: false,
      canRedo: false,
      saveBlocker: expect.any(String),
    });
    expect(textOf(result)).not.toContain('holiday-secret');
    expect(textOf(result)).toContain('media://abc123');
    expect(Array.isArray(result.data.availablePartials)).toBe(true);
  });

  it('can leave the editor state out', async () => {
    const result = await toolCaller(createFakePort())('get_template', { includeEditorState: false });

    expect(result.data.editor).toBeUndefined();
  });
});

describe('list_sections', () => {
  it('lists positions, pointers, timing and text slots; music has no pointer', async () => {
    const port = createFakePort(addSection(STARTER_PRESETS[0].build(), 'music'));
    const result = await toolCaller(port)('list_sections');
    const sections = result.data.sections as Array<Record<string, unknown>>;

    expect(sections.map((section) => section.type)).toEqual([
      'color_background',
      'project_video',
      'color_background',
      'music',
    ]);
    expect(sections[0]).toMatchObject({
      position: 0,
      pointer: '/sections/0',
      name: 'color_1',
      start: 0,
      errorCount: 0,
    });
    expect(sections[0].texts).toContainEqual({
      pointer: '/sections/0/titleCard/headline/en',
      role: 'headline',
      value: 'Your headline here',
    });
    expect(sections[3]).toMatchObject({ position: 3, pointer: null, type: 'music' });
  });
});

describe('select_section', () => {
  it('selects by name or position and refuses ambiguous or unknown refs', async () => {
    const port = createFakePort(STARTER_PRESETS[0].build());
    const call = toolCaller(port);

    expect((await call('select_section', { name: 'video_1' })).data.selectedPosition).toBe(1);
    expect(port.selected).toBe(1);
    expect((await call('select_section', { position: 2 })).data.selectedPosition).toBe(2);
    expect((await call('select_section', { name: 'nope' })).data.code).toBe('not_found');
    expect((await call('select_section', { name: 'video_1', position: 1 })).data.code).toBe('invalid_input');
    expect((await call('select_section', { position: 9 })).data.code).toBe('not_found');
  });

  it('resolvePosition returns a position or an error result', () => {
    const state = STARTER_PRESETS[0].build();

    expect(resolvePosition(state, { name: 'color_2' })).toBe(2);
    expect(typeof resolvePosition(state, {})).toBe('object');
  });
});
