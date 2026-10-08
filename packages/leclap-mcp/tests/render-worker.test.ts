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

  const originalTerm = new Set(process.listeners('SIGTERM'));

  afterEach(() => {
    process.send = originalSend;
    for (const listener of process.listeners('SIGTERM')) {
      if (!originalTerm.has(listener)) process.removeListener('SIGTERM', listener);
    }
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

  it('sends the engine QC report with a successful render', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'leclap-worker-')), 'output.mp4');
    fs.writeFileSync(output, 'mp4');
    const qc = { verified: true, content: false, findings: [] };
    // The first test already loaded the worker; load it again so its IPC listener is registered anew.
    vi.resetModules();
    const { container } = await import('ffmpeg-video-composer');
    vi.mocked(container.resolve).mockReturnValue({ getInfos: async () => ({ duration: 1 }) } as never);
    compileMock.mockImplementation(
      async (_config: unknown, _template: unknown, reporter?: { onQc?: (report: unknown) => void }) => {
        reporter?.onQc?.(qc);

        return output;
      }
    );
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const sent = new Promise<unknown>((resolve) => {
      process.send = ((message: unknown, _handle: unknown, _options: unknown, callback?: () => void) => {
        callback?.();
        resolve(message);

        return true;
      }) as typeof process.send;
    });

    await import('../src/worker/renderWorker');
    process.emit('message', { projectConfig: {}, template: {} } as never, undefined);

    await expect(sent).resolves.toMatchObject({ ok: true, outputPath: output, sizeBytes: 3, qc });
  });

  it('cancels the running compile on SIGTERM, so its transcriber and encoder children are killed', async () => {
    vi.resetModules();
    let signal: AbortSignal | undefined;
    compileMock.mockImplementation(
      (_config: unknown, _template: unknown, reporter?: { signal?: AbortSignal }) =>
        new Promise(() => {
          signal = reporter?.signal;
        })
    );
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    await import('../src/worker/renderWorker');
    process.emit('message', { projectConfig: {}, template: {} } as never, undefined);
    await vi.waitFor(() => expect(signal).toBeDefined());
    process.emit('SIGTERM', 'SIGTERM');

    expect(signal?.aborted).toBe(true);
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());
  });
});
