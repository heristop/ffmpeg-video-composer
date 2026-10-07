// React view over the shared API key store: the current key for a provider plus save/forget, and
// how many keys are stored (for "Forget all"). The snapshots are the values themselves (strings and
// numbers), so React — and the compiler's memoization — see every change.
import { useSyncExternalStore } from 'react';
import { apiKeyStore } from '@/infrastructure/ai/key-store';

export interface ApiKeyState {
  key: string;
  // Returns false when the browser refused to persist the key (it still works this session).
  save: (key: string) => boolean;
  forget: () => void;
}

export function useApiKey(providerId: string): ApiKeyState {
  const read = () => apiKeyStore.get(providerId);
  const key = useSyncExternalStore(apiKeyStore.subscribe, read, read);

  return {
    key,
    save: (next) => apiKeyStore.set(providerId, next),
    forget: () => {
      apiKeyStore.forget(providerId);
    },
  };
}

function storedCount(): number {
  return apiKeyStore.ids().length;
}

export function useStoredKeyCount(): { count: number; forgetAll: () => void } {
  const count = useSyncExternalStore(apiKeyStore.subscribe, storedCount, storedCount);

  return { count, forgetAll: apiKeyStore.forgetAll };
}
