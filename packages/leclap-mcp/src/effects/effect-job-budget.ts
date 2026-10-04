const MAX_PENDING_JOBS = 8;
let active = false;
const pending: Array<() => void> = [];

function createRelease(): () => void {
  let released = false;

  return () => {
    if (released) return;
    released = true;
    const grant = pending.shift();

    if (grant) {
      grant();

      return;
    }
    active = false;
  };
}

function abortError(): Error {
  return new DOMException('Effect job queue wait aborted', 'AbortError');
}

/** Queue waiting has its own deadline; callers start the worker deadline after acquisition. */
export function acquireEffectJobPermit(timeoutMs: number, signal?: AbortSignal): Promise<() => void> {
  if (signal?.aborted) return Promise.reject(abortError());

  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 2_147_483_647) {
    return Promise.reject(new Error('Effect job queue timeout must be between 0 and 2147483647 milliseconds'));
  }

  if (!active) {
    active = true;

    return Promise.resolve(createRelease());
  }

  if (pending.length >= MAX_PENDING_JOBS) {
    return Promise.reject(new Error('Effect job queue capacity exceeded: at most 8 pending jobs are allowed'));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    function cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
    function fail(error: Error) {
      if (settled) return;
      settled = true;
      const index = pending.indexOf(grant);

      if (index !== -1) pending.splice(index, 1);
      cleanup();
      reject(error);
    }
    function onAbort() {
      fail(abortError());
    }
    function grant() {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(createRelease());
    }
    const timer = setTimeout(() => {
      fail(new Error(`Effect job queue wait timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    pending.push(grant);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
