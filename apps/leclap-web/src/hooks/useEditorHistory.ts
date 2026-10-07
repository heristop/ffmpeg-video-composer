// React adapter over the shared (pure) createHistory closure: it keeps a useState mirror of the
// closure's current entry so React re-renders on every set/undo/redo, while the bounded undo/redo
// stacks live entirely in the closure. The closure is created once (lazy useState init) and lives
// for the editor's lifetime.
import { useState, useRef } from 'react';
import { createHistory, type EditorState, type History } from '@/presentation/components/admin/templateEditorModel';

export interface EditorHistory {
  state: EditorState;
  // Replace the present state (clears redo). The argument can be the next state or a reducer of the
  // current state — the latter keeps op call sites terse: `set((s) => addSection(s, 'video'))`.
  set: (next: EditorState | ((current: EditorState) => EditorState)) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  // Replace the entire history (used by JSON import): the new state becomes an undoable entry.
  reset: (next: EditorState) => void;
  // The closure's present entry, current even before React re-renders (callers outside render, such as
  // browser-agent tools, read the state their own last call produced).
  read: () => { state: EditorState; canUndo: boolean; canRedo: boolean };
}

interface Mirror {
  state: EditorState;
  canUndo: boolean;
  canRedo: boolean;
}

function snapshot(history: History): Mirror {
  return { state: history.state, canUndo: history.canUndo, canRedo: history.canRedo };
}

export function useEditorHistory(initial: EditorState): EditorHistory {
  const historyRef = useRef<History | null>(null);
  historyRef.current ??= createHistory(initial);

  const history = historyRef.current;
  const [mirror, setMirror] = useState<Mirror>(() => snapshot(history));

  const set = (next: EditorState | ((current: EditorState) => EditorState)): void => {
    const resolved = typeof next === 'function' ? next(history.state) : next;

    if (resolved === history.state) return;

    history.set(resolved);
    setMirror(snapshot(history));
  };

  const undo = (): void => {
    history.undo();
    setMirror(snapshot(history));
  };

  const redo = (): void => {
    history.redo();
    setMirror(snapshot(history));
  };

  const reset = (next: EditorState): void => {
    history.set(next);
    setMirror(snapshot(history));
  };

  return {
    state: mirror.state,
    set,
    undo,
    redo,
    canUndo: mirror.canUndo,
    canRedo: mirror.canRedo,
    reset,
    read: () => snapshot(history),
  };
}
