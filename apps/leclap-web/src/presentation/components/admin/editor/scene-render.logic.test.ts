import { describe, expect, it } from 'vitest';
import { newSection, type EditorState } from '../templateEditorModel';
import { sceneOnlyState } from './scene-render.logic';

describe('sceneOnlyState', () => {
  const state = {
    name: 'Promo',
    orientation: 'square',
    sections: [newSection('color'), newSection('image'), newSection('video')],
    globalLook: 'warm',
    formats: { story: {} },
  } as unknown as EditorState;

  it('keeps one scene and the whole-video settings, without per-format renders', () => {
    const scene = sceneOnlyState(state, 1);

    expect(scene?.sections).toEqual([state.sections[1]]);
    expect(scene).toMatchObject({ name: 'Promo', orientation: 'square', globalLook: 'warm' });
    expect(scene?.formats).toBeUndefined();
  });

  it('has nothing to render for a missing scene', () => {
    expect(sceneOnlyState(state, 3)).toBeNull();
    expect(sceneOnlyState(state, -1)).toBeNull();
  });
});
