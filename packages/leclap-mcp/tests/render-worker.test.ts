import { afterEach, describe, expect, it, vi } from 'vitest';

const compileMock = vi.fn();

vi.mock('ffmpeg-video-composer', () => ({
  compile: (...args: unknown[]) => compileMock(...args),
  container: { resolve: vi.fn() },
}));

// The worker answers the parent over IPC only. A compile that resolves null used to come back as a
// bare `{ ok: false }`, so compose_video could only say "compilation failed"; the engine's cause —
// which names the failing section — has to travel in `error`.
describe('render worker', () => {
  const originalSend = process.send;
  const originalListeners = new Set(process.listeners('message'));

  afterEach(() => {
    process.send = originalSend;
    for (const listener of process.listeners('message')) {
      if (!originalListeners.has(listener)) process.removeListener('message', listener);
    }
    vi.restoreAllMocks();
  });

  it('forwards the section failure reported by the engine', async () => {
    compileMock.mockImplementation(
      async (_config: unknown, _template: unknown, reporter?: { onError?: (e: Error) => void }) => {
        reporter?.onError?.(new Error('Section "broken" failed: font Nope.ttf could not be resolved'));

        return null;
      }
    );
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const sent = new Promise<unknown>((resolve) => {
      process.send = ((message: unknown, _handle: unknown, _options: unknown, callback?: () => void) => {
        callback?.();
        resolve(message);

        return true;
      }) as typeof process.send;
    });

    await import('../src/worker/renderWorker');
    process.emit('message', { projectConfig: {}, template: {} } as never, undefined);

    await expect(sent).resolves.toEqual({
      ok: false,
      error: 'Section "broken" failed: font Nope.ttf could not be resolved',
    });
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
  });
});
