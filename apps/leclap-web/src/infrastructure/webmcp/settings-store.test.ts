import { describe, expect, it } from 'vitest';
import type { KeyStorage } from '@/infrastructure/ai/key-store';
import { createWebMcpSettingsStore, DEFAULT_WEBMCP_SETTINGS, WEBMCP_STORAGE_KEY } from './settings-store';

function memoryStorage(initial: Record<string, string> = {}): KeyStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));

  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

describe('WebMCP settings store', () => {
  it('defaults to on, without asking, without the polyfill', () => {
    expect(createWebMcpSettingsStore(memoryStorage()).get()).toEqual(DEFAULT_WEBMCP_SETTINGS);
    expect(DEFAULT_WEBMCP_SETTINGS).toEqual({ enabled: true, askBeforeEdit: false, polyfill: false });
  });

  it('persists only explicit choices and notifies subscribers', () => {
    const storage = memoryStorage();
    const store = createWebMcpSettingsStore(storage);
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });

    expect(store.set({ enabled: false })).toBe(true);
    expect(store.get().enabled).toBe(false);
    expect(JSON.parse(storage.data.get(WEBMCP_STORAGE_KEY) ?? '{}')).toEqual({ enabled: false });
    unsubscribe();
    store.set({ askBeforeEdit: true });
    expect(calls).toBe(1);
    expect(createWebMcpSettingsStore(storage).get()).toEqual({ enabled: false, askBeforeEdit: true, polyfill: false });
  });

  it('ignores corrupt or mistyped records', () => {
    const corrupt = memoryStorage({ [WEBMCP_STORAGE_KEY]: '{nope' });
    const mistyped = memoryStorage({ [WEBMCP_STORAGE_KEY]: '{"enabled":"no","polyfill":true}' });

    expect(createWebMcpSettingsStore(corrupt).get()).toEqual(DEFAULT_WEBMCP_SETTINGS);
    expect(createWebMcpSettingsStore(mistyped).get()).toEqual({ ...DEFAULT_WEBMCP_SETTINGS, polyfill: true });
  });

  it('keeps working from memory when storage throws or is missing', () => {
    const throwing: KeyStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => undefined,
    };
    const store = createWebMcpSettingsStore(throwing);

    expect(store.set({ enabled: false })).toBe(false);
    expect(store.get().enabled).toBe(false);
    expect(createWebMcpSettingsStore(null).set({ askBeforeEdit: true })).toBe(false);
  });
});
