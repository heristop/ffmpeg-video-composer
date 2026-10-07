// The in-page confirmation queue browser-agent actions wait on. WebMCP has no confirmation API of its own
// yet, so the page asks: a request waits for the user's answer and resolves false when they decline,
// dismiss it, it times out (120 s), or the agent aborts the call. One dialog shows the head of the queue;
// "Ask before every edit" uses it now, and the consequential tools (replace, sample, render, save) reuse it.
import type { ConfirmRequest } from '@/application/usecases/webmcp/types';

export const CONFIRM_TIMEOUT_MS = 120_000;

export interface PendingConfirm {
  id: number;
  request: ConfirmRequest;
}

interface Entry extends PendingConfirm {
  settle: (accepted: boolean) => void;
}

export interface ConfirmQueue {
  /** Waits for the user's answer to `request`. */
  request: (request: ConfirmRequest, signal: AbortSignal) => Promise<boolean>;
  /** The user's answer to the request `id`; ignored when it was already settled. */
  answer: (id: number, accepted: boolean) => void;
  /** Declines everything waiting (the agent was turned off, the builder closed, another overlay took over). */
  declineAll: () => void;
  /** The request on screen, or null. */
  head: () => PendingConfirm | null;
  subscribe: (listener: () => void) => () => void;
}

export function createConfirmQueue(timeoutMs = CONFIRM_TIMEOUT_MS): ConfirmQueue {
  let entries: Entry[] = [];
  let sequence = 0;
  const listeners = new Set<() => void>();
  // A stable snapshot for useSyncExternalStore: replaced only when the head changes.
  let current: PendingConfirm | null = null;
  const emit = (): void => {
    const first = entries.at(0);

    if (first?.id !== current?.id) current = first ? { id: first.id, request: first.request } : null;

    for (const listener of listeners) listener();
  };

  const answer = (id: number, accepted: boolean): void => {
    const entry = entries.find((candidate) => candidate.id === id);

    if (!entry) return;

    entries = entries.filter((candidate) => candidate !== entry);
    entry.settle(accepted);
    emit();
  };

  const enqueue = (request: ConfirmRequest, signal: AbortSignal, resolve: (accepted: boolean) => void): void => {
    sequence += 1;
    const id = sequence;
    const onAbort = (): void => {
      answer(id, false);
    };
    const timer = setTimeout(onAbort, timeoutMs);
    const settle = (accepted: boolean): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(accepted);
    };

    signal.addEventListener('abort', onAbort, { once: true });
    entries = [...entries, { id, request, settle }];
    emit();
  };

  return {
    request: (request, signal) =>
      new Promise<boolean>((resolve) => {
        if (signal.aborted) {
          resolve(false);

          return;
        }

        enqueue(request, signal, resolve);
      }),
    answer,
    declineAll: () => {
      for (const entry of entries) answer(entry.id, false);
    },
    head: () => current,
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}
