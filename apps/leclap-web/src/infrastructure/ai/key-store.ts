// Holds the user's AI provider keys. They are kept in this browser's localStorage, one entry per
// provider under a single namespaced record (`leclap.ai.keys.v1`), so they survive reloads. Every
// storage access is guarded: in private mode or with storage blocked the store silently falls back
// to memory for the session. Keys are never logged and leave this module only towards the adapter
// that puts them in its own provider's auth header. "Forget key" / "Forget all" remove them.

export interface KeyStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export interface ApiKeyStore {
  get: (providerId: string) => string;
  // Returns false when the browser refused to persist it (the key still works for this session).
  set: (providerId: string, key: string) => boolean;
  forget: (providerId: string) => void;
  forgetAll: () => void;
  // Provider ids that currently hold a key.
  ids: () => string[];
  subscribe: (listener: () => void) => () => void;
  // Bumps on every change, for useSyncExternalStore.
  version: () => number;
}

export const STORAGE_KEY = 'leclap.ai.keys.v1';

function safe<T>(run: () => T, fallback: T): T {
  try {
    return run();
  } catch {
    return fallback;
  }
}

function readRecord(storage: KeyStorage | null): Record<string, string> {
  const raw = storage ? safe(() => storage.getItem(STORAGE_KEY), null) : null;
  const parsed = raw ? safe<unknown>(() => JSON.parse(raw), null) : null;

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

  return Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '')
  );
}

function writeRecord(storage: KeyStorage | null, record: Record<string, string>): boolean {
  if (!storage) return false;

  return safe(() => {
    if (Object.keys(record).length === 0) {
      storage.removeItem(STORAGE_KEY);

      return true;
    }
    storage.setItem(STORAGE_KEY, JSON.stringify(record));

    return true;
  }, false);
}

export function createKeyStore(storage: KeyStorage | null): ApiKeyStore {
  // Memory mirror: the source of truth for this session, seeded from storage once.
  const memory = new Map<string, string>(Object.entries(readRecord(storage)));
  const listeners = new Set<() => void>();
  let revision = 0;

  const commit = (): boolean => {
    const ok = writeRecord(storage, Object.fromEntries(memory));
    revision += 1;

    for (const listener of listeners) listener();

    return ok;
  };

  return {
    get: (id) => memory.get(id) ?? '',
    set: (id, key) => {
      const trimmed = key.trim();
      memory.delete(id);

      if (trimmed !== '') memory.set(id, trimmed);

      return commit();
    },
    forget: (id) => {
      memory.delete(id);
      commit();
    },
    forgetAll: () => {
      memory.clear();
      commit();
    },
    ids: () => [...memory.keys()],
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    version: () => revision,
  };
}

function browserStorage(): KeyStorage | null {
  return safe(() => (typeof window === 'undefined' ? null : window.localStorage), null);
}

// The app-wide store shared by every dialog.
export const apiKeyStore = createKeyStore(browserStorage());
