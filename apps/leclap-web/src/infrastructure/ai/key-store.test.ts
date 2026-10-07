import { describe, expect, it, vi } from 'vitest';
import { createKeyStore, STORAGE_KEY, type KeyStorage } from './key-store';

function memoryStorage(): KeyStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();

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

describe('createKeyStore', () => {
  it('persists keys in this browser under one namespaced record, one entry per provider', () => {
    const storage = memoryStorage();
    const store = createKeyStore(storage);

    expect(store.set('anthropic', '  sk-ant-abc  ')).toBe(true);
    store.set('openai', 'sk-123');

    expect(store.get('anthropic')).toBe('sk-ant-abc');
    expect([...storage.data.keys()]).toEqual([STORAGE_KEY]);
    expect(JSON.parse(storage.data.get(STORAGE_KEY) ?? '')).toEqual({ anthropic: 'sk-ant-abc', openai: 'sk-123' });
    // A reload (a fresh store over the same storage) sees them.
    expect(createKeyStore(storage).get('openai')).toBe('sk-123');
  });

  it('forgets one provider, then all, removing the record when empty', () => {
    const storage = memoryStorage();
    const store = createKeyStore(storage);
    store.set('anthropic', 'a');
    store.set('openai', 'b');
    store.set('jev', 'c');

    store.forget('openai');

    expect(store.ids()).toEqual(['anthropic', 'jev']);
    expect(JSON.parse(storage.data.get(STORAGE_KEY) ?? '')).toEqual({ anthropic: 'a', jev: 'c' });

    store.forgetAll();

    expect(store.get('anthropic')).toBe('');
    expect(storage.data.size).toBe(0);
  });

  it('setting an empty key clears it', () => {
    const store = createKeyStore(memoryStorage());
    store.set('jev', 'key-1');
    store.set('jev', '   ');

    expect(store.ids()).toEqual([]);
  });

  it('falls back to memory when storage throws (private mode) and ignores a corrupt record', () => {
    const throwing: KeyStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    const store = createKeyStore(throwing);

    expect(store.set('anthropic', 'sk-ant-x')).toBe(false);
    expect(store.get('anthropic')).toBe('sk-ant-x');
    expect(() => {
      store.forgetAll();
    }).not.toThrow();

    const corrupt = memoryStorage();
    corrupt.data.set(STORAGE_KEY, '{not json');

    expect(createKeyStore(corrupt).ids()).toEqual([]);
    expect(createKeyStore(null).set('a', 'b')).toBe(false);
  });

  it('notifies subscribers and bumps its version', () => {
    const store = createKeyStore(null);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.set('anthropic', 'k');
    unsubscribe();
    store.forget('anthropic');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.version()).toBe(2);
  });

  it('never logs a key', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {})
    );
    const store = createKeyStore(memoryStorage());

    store.set('anthropic', 'sk-ant-should-not-log');
    store.get('anthropic');
    store.forgetAll();

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
