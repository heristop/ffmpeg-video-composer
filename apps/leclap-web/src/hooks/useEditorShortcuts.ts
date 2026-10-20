// Global keyboard shortcuts for the studio editor. A single window-level keydown listener owned by the
// shell (the one place that holds every callback). Key matching lives in the pure editor-shortcuts.logic
// module; this hook only attaches/detaches and dispatches. Handlers are read through a ref so the
// listener binds once and never re-attaches on re-render.
import { useEffect, useRef } from 'react';
import {
  resolveShortcut,
  isTypingTarget,
  ALWAYS_ALLOW_IN_INPUTS,
  SCENE_STRIP_ONLY,
  inSceneStrip,
  type EditorShortcutAction,
} from './editor-shortcuts.logic';

export interface EditorShortcutHandlers {
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onDeleteScene: () => void;
  onDuplicateScene: () => void;
  onAddScene: () => void;
  onNextScene: () => void;
  onPrevScene: () => void;
  onNextTool: () => void;
  onPrevTool: () => void;
  // Optional: no live player exists until the program-monitor phase, so Space stays inert (and is NOT
  // swallowed) until a handler is wired.
  onTogglePlay?: () => void;
  onShowHelp: () => void;
  onDismissHelp: () => void;
  // Deck transport: frame/second steps, edit-point jumps and J/K/L shuttle. Absent = key left alone.
  onStep?: (frames: number, unit: 'frame' | 'second') => void;
  onJumpEdit?: (direction: 1 | -1) => void;
  onShuttle?: (direction: 1 | -1 | 0) => void;
  // Disable the whole layer while another surface owns the keyboard (e.g. a modal). Defaults to true.
  enabled?: boolean;
}

// A handler bound to its arguments, or undefined when the handler isn't wired.
function bind<A extends unknown[]>(fn: ((...args: A) => void) | undefined, ...args: A): (() => void) | undefined {
  if (!fn) return undefined;

  return () => {
    fn(...args);
  };
}

// Resolve an action to its handler (or undefined when the feature isn't wired). A missing handler means
// the key is left alone — no preventDefault — so native behaviour (e.g. Space activating a button) stays.
const handlerFor = (action: EditorShortcutAction, h: EditorShortcutHandlers): (() => void) | undefined => {
  const map: Record<EditorShortcutAction, (() => void) | undefined> = {
    undo: h.onUndo,
    redo: h.onRedo,
    save: h.onSave,
    'delete-scene': h.onDeleteScene,
    'duplicate-scene': h.onDuplicateScene,
    'add-scene': h.onAddScene,
    'next-scene': h.onNextScene,
    'prev-scene': h.onPrevScene,
    'next-tool': h.onNextTool,
    'prev-tool': h.onPrevTool,
    'toggle-play': h.onTogglePlay,
    'show-help': h.onShowHelp,
    'dismiss-help': h.onDismissHelp,
    'frame-back': bind(h.onStep, -1, 'frame'),
    'frame-forward': bind(h.onStep, 1, 'frame'),
    'second-back': bind(h.onStep, -1, 'second'),
    'second-forward': bind(h.onStep, 1, 'second'),
    'prev-edit': bind(h.onJumpEdit, -1),
    'next-edit': bind(h.onJumpEdit, 1),
    'shuttle-back': bind(h.onShuttle, -1),
    'shuttle-stop': bind(h.onShuttle, 0),
    'shuttle-forward': bind(h.onShuttle, 1),
  };

  return map[action];
};

export function useEditorShortcuts(handlers: EditorShortcutHandlers): void {
  const ref = useRef(handlers);

  useEffect(() => {
    ref.current = handlers;
  }, [handlers]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const current = ref.current;

      if (current.enabled === false) return;

      const action = resolveShortcut(event);

      if (!action) return;

      const run = handlerFor(action, current);

      if (!run) return;

      const target = event.target as (HTMLElement & { isContentEditable: boolean }) | null;
      const typing = isTypingTarget(target);

      if (typing && !ALWAYS_ALLOW_IN_INPUTS.has(action)) return;

      if (SCENE_STRIP_ONLY.has(action) && !inSceneStrip(target)) return;

      event.preventDefault();
      run();
    };

    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
