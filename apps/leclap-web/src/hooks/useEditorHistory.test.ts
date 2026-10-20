import { describe, it, expect } from 'vitest';
import {
  createHistory,
  newSection,
  addSection,
  removeSection,
  type EditorState,
} from '@/presentation/components/admin/templateEditorModel';

// useEditorHistory is a thin React mirror over the shared, pure createHistory closure (which holds
// all the undo/redo/bound logic). We can't render the hook in the node test env, so we exercise the
// closure through the same web import path the hook uses — proving undo, redo, redo-clear-on-set and
// the 50-entry bound are all reachable from the web boundary.
function base(): EditorState {
  return {
    id: 'user-1',
    name: 'T',
    description: '',
    orientation: 'landscape',
    sections: [newSection('video')],
    globalVariables: [],
    audio: { sourceVolume: 1, musicVolume: 0.5, ducking: false },
    defaultTransition: { type: 'cut', duration: 0.5 },
    globalAnimations: [],
    globalOverlays: [],
  };
}

describe('createHistory (useEditorHistory backbone)', () => {
  it('starts with nothing to undo or redo', () => {
    const history = createHistory(base());
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });

  it('undo restores the previous state and redo re-applies it', () => {
    const history = createHistory(base());
    const next = addSection(history.state, 'color');
    history.set(next);

    expect(history.state.sections).toHaveLength(2);
    expect(history.canUndo).toBe(true);

    history.undo();
    expect(history.state.sections).toHaveLength(1);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);

    history.redo();
    expect(history.state.sections).toHaveLength(2);
    expect(history.canRedo).toBe(false);
  });

  it('a new set clears the redo stack', () => {
    const history = createHistory(base());
    history.set(addSection(history.state, 'color'));
    history.undo();
    expect(history.canRedo).toBe(true);

    history.set(addSection(history.state, 'image'));
    expect(history.canRedo).toBe(false);
    expect(history.state.sections.at(-1)?.kind).toBe('image');
  });

  it('bounds the undo stack at 50 entries', () => {
    const history = createHistory(base());

    for (let i = 0; i < 60; i++) {
      history.set(addSection(history.state, 'color'));
    }

    // 60 sets but only 50 undoable steps survive the bound.
    let undos = 0;

    while (history.canUndo) {
      history.undo();
      undos++;
    }

    expect(undos).toBe(50);
  });

  it('undo/redo are no-ops at the ends of the stack', () => {
    const history = createHistory(base());
    history.undo();
    expect(history.state.sections).toHaveLength(1);
    history.redo();
    expect(history.state.sections).toHaveLength(1);
  });

  it('brings a deleted scene back on undo (the Delete shortcut goes through this history)', () => {
    const history = createHistory(addSection(base(), 'color'));
    history.set(removeSection(history.state, 1));

    expect(history.state.sections).toHaveLength(1);

    history.undo();

    expect(history.state.sections.map((section) => section.kind)).toEqual(['video', 'color']);
  });
});
