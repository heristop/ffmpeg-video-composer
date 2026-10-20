// Pure key-matching for the studio editor's global shortcuts. Kept DOM-free so it is fully unit
// tested; the React hook (useEditorShortcuts) owns attach/detach and dispatch. `mod` is meta-or-ctrl
// so the same table serves darwin (⌘) and everywhere else (Ctrl).

export type EditorShortcutAction =
  | 'undo'
  | 'redo'
  | 'save'
  | 'delete-scene'
  | 'duplicate-scene'
  | 'next-scene'
  | 'prev-scene'
  | 'add-scene'
  | 'toggle-play'
  | 'next-tool'
  | 'prev-tool'
  | 'show-help'
  | 'dismiss-help'
  | 'frame-back'
  | 'frame-forward'
  | 'second-back'
  | 'second-forward'
  | 'prev-edit'
  | 'next-edit'
  | 'shuttle-back'
  | 'shuttle-stop'
  | 'shuttle-forward';

// Minimal event shape so tests never touch the DOM (a real KeyboardEvent satisfies it structurally).
export interface KeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export interface TargetLike {
  tagName: string;
  isContentEditable: boolean;
  closest?: (selector: string) => unknown;
}

// Actions safe (and desirable) to fire even while a text field is focused. Bare-key actions that would
// steal typing (space, arrows, letters, delete) are deliberately excluded.
export const ALWAYS_ALLOW_IN_INPUTS: ReadonlySet<EditorShortcutAction> = new Set<EditorShortcutAction>([
  'undo',
  'redo',
  'save',
  'show-help',
  'dismiss-help',
]);

// Bare (no meta/ctrl) keys that map straight to an action, laid out like an editing deck: ←/→ step a
// frame (a second with Shift), ↑/↓ jump between edit points, J/K/L shuttle, Page Up/Down switch scene.
const BARE_KEY_ACTIONS: Record<string, EditorShortcutAction> = {
  '?': 'show-help',
  Escape: 'dismiss-help',
  Backspace: 'delete-scene',
  Delete: 'delete-scene',
  ArrowRight: 'frame-forward',
  ArrowLeft: 'frame-back',
  ArrowDown: 'next-edit',
  ArrowUp: 'prev-edit',
  PageDown: 'next-scene',
  PageUp: 'prev-scene',
  ' ': 'toggle-play',
  ']': 'next-tool',
  '[': 'prev-tool',
};

const LETTER_ACTIONS: Record<string, EditorShortcutAction> = {
  n: 'add-scene',
  j: 'shuttle-back',
  k: 'shuttle-stop',
  l: 'shuttle-forward',
};

const SHIFTED_ACTIONS: Partial<Record<EditorShortcutAction, EditorShortcutAction>> = {
  'frame-forward': 'second-forward',
  'frame-back': 'second-back',
};

// Actions that destroy work answer only inside the scene strip, so a stray Delete in a panel or on the
// canvas never removes a scene.
export const SCENE_STRIP_ONLY: ReadonlySet<EditorShortcutAction> = new Set<EditorShortcutAction>(['delete-scene']);

export function inSceneStrip(t: TargetLike | null): boolean {
  return Boolean(t?.closest?.('[data-scene-strip]'));
}

// ⌘/Ctrl chords (Alt already excluded by the caller). `k` is the lower-cased key.
function resolveModShortcut(k: string, shiftKey: boolean): EditorShortcutAction | null {
  if (k === 'z') return shiftKey ? 'redo' : 'undo';

  if (k === 'y') return 'redo';

  if (k === 's') return 'save';

  if (k === 'd') return 'duplicate-scene';

  return null;
}

// Bare (optionally shifted) keys — table lookup (Shift turns a frame step into a second), plus letters.
function resolveBareShortcut(e: KeyEventLike): EditorShortcutAction | null {
  const direct = BARE_KEY_ACTIONS[e.key] as EditorShortcutAction | undefined;

  if (direct && e.shiftKey) return SHIFTED_ACTIONS[direct] ?? direct;

  if (direct) return direct;

  return LETTER_ACTIONS[e.key.toLowerCase()] ?? null;
}

export function resolveShortcut(e: KeyEventLike): EditorShortcutAction | null {
  const mod = e.metaKey || e.ctrlKey;

  if (mod && !e.altKey) return resolveModShortcut(e.key.toLowerCase(), e.shiftKey);

  // Any other meta/ctrl combination (including Alt chords) is not a shortcut.
  if (mod) return null;

  return resolveBareShortcut(e);
}

export function isTypingTarget(t: TargetLike | null): boolean {
  if (!t) return false;

  if (t.isContentEditable) return true;

  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}
