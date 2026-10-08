import type { CompileReporter } from '../core/types';
import type { IEventEmitter } from './AbstractEventManager';

export interface CompilationListeners {
  // Reads any error captured from a `task-stopped` event during compilation.
  getError: () => unknown;
  // Removes the listeners from the emitter.
  detach: () => void;
}

// Subscribe a caller's progress callback and capture any `task-stopped` error on a compilation
// emitter, returning a handle to read the error and detach again. Shared by the browser entry and the
// Node `compile()` so both forward the director's per-segment progress (0..1) identically. The emitter
// can be a singleton (browser) reused across compilations, so `detach()` must be called once a
// compilation settles to stop listeners accumulating and double-firing on the next run.
//
// An aborted `signal` cancels the compilation: it emits `task-cancelled` on the same emitter.
export function attachCompilationListeners(
  emitter: IEventEmitter,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal
): CompilationListeners {
  let compilationError: unknown = null;

  function onStopped(err: unknown): void {
    compilationError = err;
  }

  function onProgressEvent(fraction: unknown): void {
    onProgress?.(typeof fraction === 'number' ? fraction : 0);
  }

  function onAbort(): void {
    emitter.emit('task-cancelled');
  }

  emitter.on('task-stopped', onStopped);
  emitter.on('compilation-progress', onProgressEvent);
  signal?.addEventListener('abort', onAbort, { once: true });

  if (signal?.aborted) onAbort();

  return {
    getError: () => compilationError,
    detach: () => {
      emitter.off?.('task-stopped', onStopped);
      emitter.off?.('compilation-progress', onProgressEvent);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

// Why compile() failed: a caller that takes onError owns the failure (the CLI prints the message alone, even
// with -q); without one, the message and stack go to stderr.
export function reportCompileFailure(error: unknown, reporter: CompileReporter | undefined): void {
  const failure = error instanceof Error ? error : new Error(`Unknown compilation error: ${JSON.stringify(error)}`);

  if (reporter?.onError) {
    reporter.onError(failure);

    return;
  }

  console.error(error instanceof Error ? `Compilation error: ${failure.message}` : 'Unknown compilation error');

  if (error instanceof Error && error.stack) console.error('Stack:', error.stack);
}
