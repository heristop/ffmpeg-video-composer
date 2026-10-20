// Broadcast-style safe areas over the monitor frame: the 90% action-safe and 80% title-safe boxes plus
// a centre cross and the frame's format, switched from the monitor's status strip. The switch is a
// per-viewer convenience, remembered in this browser when storage allows it.
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { EditorState } from '../templateEditorModel';
import { PREVIEW_FPS } from './program-music.logic';

const STORAGE_KEY = 'leclap.safeGuides';
const listeners = new Set<() => void>();
let shown = readStored();

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function setShown(next: boolean): void {
  shown = next;

  try {
    localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
  } catch {
    // Private windows and blocked storage: the switch still works for this session.
  }

  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

const snapshot = (): boolean => shown;

export function useSafeGuides(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

const ASPECT: Record<EditorState['orientation'], string> = { landscape: '16:9', portrait: '9:16', square: '1:1' };

// "16:9 · 30 fps": the frame shape and the rate the transport counts in.
export function formatLabel(orientation: EditorState['orientation'], fpsLabel: string): string {
  return `${ASPECT[orientation]} · ${fpsLabel}`;
}

export function SafeGuides({ orientation }: { orientation: EditorState['orientation'] }) {
  const { t } = useTranslation('admin');
  const on = useSafeGuides();

  if (!on) return null;

  return (
    <div aria-hidden="true" data-safe-guides="" className="pointer-events-none absolute inset-0 z-30">
      <span className="absolute inset-[5%] rounded-[2px] border border-dashed border-player-fg/45" />
      <span className="absolute inset-[10%] rounded-[2px] border border-dashed border-player-fg/30" />
      <span className="absolute left-1/2 top-1/2 h-3 w-px -translate-1/2 bg-player-fg/45" />
      <span className="absolute left-1/2 top-1/2 h-px w-3 -translate-1/2 bg-player-fg/45" />
      <span className="absolute left-2 top-2 rounded-[0.25rem] bg-player-ink/65 px-1.5 py-0.5 font-mono text-[0.625rem] tabular-nums text-player-fg/85">
        {formatLabel(orientation, t('monitor.fps', { fps: PREVIEW_FPS }))}
      </span>
    </div>
  );
}

export function SafeGuidesToggle() {
  const { t } = useTranslation('admin');
  const on = useSafeGuides();

  return (
    <button
      type="button"
      aria-pressed={on}
      title={t('shell.safeGuidesTooltip')}
      onClick={() => {
        setShown(!on);
      }}
      className={cn(
        'rounded-[0.3125rem] px-1.5 py-0.5 text-[0.62rem] font-semibold uppercase tracking-[0.14em] transition-colors',
        on ? 'bg-brand-500/20 text-brand-200' : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'
      )}
    >
      {t('shell.safeGuides')}
    </button>
  );
}
