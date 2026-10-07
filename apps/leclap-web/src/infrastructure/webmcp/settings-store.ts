// The browser-agent (WebMCP) preferences for this browser, under one namespaced localStorage record
// (`leclap.webmcp.v1`). Every storage access is guarded: with storage blocked the store keeps working
// from memory for the session. Only explicit choices are stored, so the defaults can change later:
// tools are on when the browser offers WebMCP, and edits run without asking (each is one undo step).
import type { KeyStorage } from '@/infrastructure/ai/key-store';

export interface WebMcpSettings {
  /** Let browser agents use the builder. Default on. */
  enabled: boolean;
  /** Ask in the page before every edit an agent makes. Default off. */
  askBeforeEdit: boolean;
  /** Dev/e2e builds only: load the WebMCP polyfill when the browser has no native API. */
  polyfill: boolean;
}

export interface WebMcpSettingsStore {
  get: () => WebMcpSettings;
  /** Returns false when the browser refused to persist it (the choice still applies this session). */
  set: (patch: Partial<WebMcpSettings>) => boolean;
  subscribe: (listener: () => void) => () => void;
}

export const WEBMCP_STORAGE_KEY = 'leclap.webmcp.v1';

export const DEFAULT_WEBMCP_SETTINGS: WebMcpSettings = { enabled: true, askBeforeEdit: false, polyfill: false };

const KEYS = ['enabled', 'askBeforeEdit', 'polyfill'] as const;

function safe<T>(run: () => T, fallback: T): T {
  try {
    return run();
  } catch {
    return fallback;
  }
}

function readStored(storage: KeyStorage | null): Partial<WebMcpSettings> {
  const raw = storage ? safe(() => storage.getItem(WEBMCP_STORAGE_KEY), null) : null;
  const parsed = raw ? safe<unknown>(() => JSON.parse(raw), null) : null;

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

  const record = parsed as Record<string, unknown>;

  return Object.fromEntries(KEYS.filter((key) => typeof record[key] === 'boolean').map((key) => [key, record[key]]));
}

function writeStored(storage: KeyStorage | null, stored: Partial<WebMcpSettings>): boolean {
  if (!storage) return false;

  return safe(() => {
    storage.setItem(WEBMCP_STORAGE_KEY, JSON.stringify(stored));

    return true;
  }, false);
}

export function createWebMcpSettingsStore(storage: KeyStorage | null): WebMcpSettingsStore {
  let stored = readStored(storage);
  let snapshot: WebMcpSettings = { ...DEFAULT_WEBMCP_SETTINGS, ...stored };
  const listeners = new Set<() => void>();

  return {
    get: () => snapshot,
    set: (patch) => {
      stored = { ...stored, ...patch };
      snapshot = { ...DEFAULT_WEBMCP_SETTINGS, ...stored };
      const ok = writeStored(storage, stored);

      for (const listener of listeners) listener();

      return ok;
    },
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function browserStorage(): KeyStorage | null {
  return safe(() => (typeof window === 'undefined' ? null : window.localStorage), null);
}

// The app-wide store.
export const webMcpSettings = createWebMcpSettingsStore(browserStorage());
