import { useState, useSyncExternalStore } from 'react';

interface ObjectUrlStore {
  file: File | undefined;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => string | null;
}

function createObjectUrlStore(file: File | undefined): ObjectUrlStore {
  let url: string | null = null;
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  return {
    file,
    subscribe: (listener) => {
      listeners.add(listener);

      if (file && !url) {
        url = URL.createObjectURL(file);
        notify();
      }

      return () => {
        listeners.delete(listener);

        if (listeners.size === 0 && url) {
          URL.revokeObjectURL(url);
          url = null;
        }
      };
    },
    getSnapshot: () => url,
  };
}

// Create/revoke object URLs as an external store so components do not mirror a resource into state
// from an effect. Subscription setup happens after commit, and StrictMode remounts get a fresh URL.
export function useObjectUrl(file: File | undefined): string | null {
  const [store, setStore] = useState(() => createObjectUrlStore(file));

  if (store.file !== file) setStore(createObjectUrlStore(file));

  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => null);
}
