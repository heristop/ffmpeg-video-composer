import { expect, it, vi } from 'vitest';
import { prepareTitleJob } from '../src/effects/registered-render.js';
import { renderTitleJobCached } from '../src/effects/effect-cache.js';
vi.mock('../src/effects/registered-render.js', () => ({ prepareTitleJob: vi.fn() }));
vi.mock('../src/effects/effect-cache.js', () => ({ renderTitleJobCached: vi.fn() }));

it('renders worker requests serially through the cache and aggregates diagnostics', async () => {
  const job = { provenance: { hash: 'snapshot' } };
  vi.mocked(prepareTitleJob).mockResolvedValue(job as never);
  let active = 0;
  vi.mocked(renderTitleJobCached).mockImplementation(async (_job, request) => {
    expect(active++).toBe(0);
    await Promise.resolve();
    active--;
    return {
      result: {
        path: request.kind,
        metadata: { duration: 1, cache: 'miss' as const },
        provenance: { hash: 'snapshot' },
      },
      cache: request.kind === 'still' ? { hits: 1, misses: 0, writes: 0 } : { hits: 0, misses: 1, writes: 1 },
    };
  });
  let handle: ((message: unknown) => Promise<void> | void) | undefined;
  const on = vi.spyOn(process, 'on').mockImplementation(((event: string, listener: typeof handle) => {
    if (event === 'message') handle = listener;
    return process;
  }) as typeof process.on);
  const send = vi.fn();
  vi.stubGlobal(
    'process',
    new Proxy(process, { get: (target, key) => (key === 'send' ? send : Reflect.get(target, key)) })
  );
  try {
    await import('../src/worker/effectWorker.js');
    await handle?.({
      title: {},
      config: {},
      directory: '/job',
      requests: [{ kind: 'still', frame: 0 }, { kind: 'video' }],
    });
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    expect(renderTitleJobCached).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toMatchObject({
      ok: true,
      provenance: job.provenance,
      cache: { hits: 1, misses: 1, writes: 1 },
    });
  } finally {
    on.mockRestore();
    vi.unstubAllGlobals();
  }
});
